# Supabase 迁移交接单 — Peer 免费版改造

**给谁看：** 持有 Supabase 权限的同事，以及他的 agent。
**写给 agent 的部分是精确技术语言；SQL 原样可执行，无需访问我们的仓库。**

**日期：** 2026-09-07 · **来源分支：** `freemium-system-key` · **状态：** 代码已完成并验证，等待这三个迁移。

---

## §0 一句话

在 Supabase 的 `public` schema 里 **新增两张表、一个函数、四个列**，并 **重新声明一个已存在的触发器函数**。
**最后那一项是唯一有覆盖风险的操作 —— §2 的检查必须先做。**

---

## §1 这是什么，不是什么

### 背景（一段）

Peer 正在从「每个用户自带 AI 钥匙」改成「公司提供统一的 Gemini 钥匙，按套餐限量」。
服务端需要三样东西才能工作：**记住每个用户用了多少**（计数表）、**记录每一笔花销**（记账表）、
**知道每个用户是什么套餐**（用户资料表加四列）。这三个迁移就是这些。

### 明确的边界

| | |
|---|---|
| **会做** | `create table if not exists` × 2；`create index if not exists` × 3；`create or replace function` × 2；`alter table ... add column if not exists` × 4；`revoke` 若干；`comment on column` × 1 |
| **不会做** | 不 `drop` 任何东西；不 `delete` / `update` 任何现有数据行；不修改任何现有列的类型或约束；不触碰 `auth` schema；不新增或修改任何 RLS policy |
| **对现有功能的影响** | **零**。发起这些迁移的代码分支尚未部署。迁移执行后，线上运行的旧版本不会读写这些新对象。 |
| **可逆性** | 完全可逆，见 §5。**唯一的例外是 §2.2 那个函数** —— 它的回滚依赖你在 §2 里保存的备份。 |

### 幂等性

全部语句使用 `if not exists` / `create or replace` / `revoke`（revoke 不存在的权限不报错）。
**重复执行是安全的**，不会产生重复对象，也不会重置已有数据。

---

## §2 执行前的检查 —— 全部是读操作，零风险

**请把每一条的输出保存下来并回传。** 尤其是 2.2。

### 2.1 确认 `profiles` 表的现状

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;
```

**期望：** 表存在，且**不包含** `plan` / `trial_started_at` / `trial_ends_at` / `plan_updated_at` 这四列。
**如果已经包含其中任何一列** → 停止，回传结果，我们需要先确认那是不是同名不同义的列。

### 2.2 ⚠️ 最高风险项：备份现有的 `handle_new_user` 函数

```sql
select pg_get_functiondef(oid) as current_definition
from pg_proc
where proname = 'handle_new_user'
  and pronamespace = 'public'::regnamespace;
```

**为什么这一步不能跳过：**

迁移 3 使用 `create or replace function public.handle_new_user()`，这会**整体替换**这个函数的函数体。
我们写的版本假定它当前的内容是「向 `public.profiles` 插入一行 `user_id`」。

**如果你们那边已经给这个函数加过任何逻辑**（例如：同时往别的表插入初始数据、写审计日志、
调用其他函数、设置默认偏好），**我们的版本会把那些逻辑全部抹掉，且不会报错。**

**处理方式：**

- 把上面查到的完整定义**原样保存**（这既是回滚素材，也是比对基准）
- 与 §3.3 里我们提供的版本**逐行比对**
- **如果两者只差「插入语句多了四个 plan 相关字段」** → 直接执行我们的版本
- **如果你们的版本有额外逻辑** → **不要执行我们的版本**。把你们的定义回传给我们，
  我们会给出一个合并后的版本，保留你们的逻辑并加上四个字段

### 2.3 确认没有命名冲突

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('usage_counters', 'usage_events');

select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'increment_usage_counter';
```

**期望：两条查询都返回 0 行。** 若有任何返回 → 停止并回传。

### 2.4 现有用户数（影响第三个迁移的默认值语义）

```sql
select count(*) as existing_profiles from public.profiles;
```

**说明：** 迁移 3 给 `plan` 列设的默认值是 `'free'`，**不是** `'trial'`。
这意味着**所有已存在的行会变成 `free`，不会获得 14 天试用**。
新注册的用户由触发器给 14 天试用。这是刻意的设计，不是疏漏 —— 详见 §3.3。

如果这里返回的不是 0，请回传数字，我们需要确认是否要为这些用户补试用。

### 2.5 `profiles` 上现有的 RLS policy（仅供留档）

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'profiles';
```

**这些 policy 我们一条都不会改。** 迁移 3 使用的是**列级权限**（`revoke update (col) ...`），
与 policy 是两套独立机制，互不影响。此项仅用于执行前后对比。

---

## §3 三个迁移，按顺序执行

**顺序不能颠倒。** 每个执行完确认成功再执行下一个。

---

### §3.1 迁移一 —— 计数表与原子自增函数

**作用：** 记录「某个用户在某个时间窗口内用了多少次」。用于每小时限流、每月报告额度、每日熔断。

**设计要点（供你们的 agent 理解，非执行内容）：**

- **时间窗口写在主键里，不是列里。** key 形如 `deep:<user_id>:2026-09`、
  `rate:paper-feed:<user_id>:2026-09-07T14`。窗口切换靠 key 变化实现，
  无需定时任务清零，也不存在「两个时间源不同步」的问题。
- `window_ends_at` 仅供将来做清理用，**没有任何逻辑读它做判断**。
- **函数而非 upsert 的原因：** PostgREST 的 `resolution=merge-duplicates` 只能表达
  `set col = excluded.col`，无法表达 `value = 现值 + 增量`。用 upsert 会变成**覆盖**而非累加。
- **不使用 `security definer`：** 唯一调用者持有 service role key，本就绕过 RLS，无需提权。

```sql
create table if not exists public.usage_counters (
  key            text primary key,
  value          bigint not null default 0,
  window_ends_at timestamptz,
  updated_at     timestamptz not null default now()
);

create index if not exists usage_counters_window_ends_at_idx
  on public.usage_counters (window_ends_at);

alter table public.usage_counters enable row level security;

revoke all on table public.usage_counters from anon, authenticated;

create or replace function public.increment_usage_counter(
  p_key            text,
  p_window_ends_at timestamptz default null,
  p_by             bigint default 1
) returns bigint
language plpgsql
as $$
declare
  v_value bigint;
begin
  insert into public.usage_counters as c (key, value, window_ends_at, updated_at)
  values (p_key, p_by, p_window_ends_at, now())
  on conflict (key) do update
    set value          = c.value + excluded.value,
        window_ends_at = coalesce(excluded.window_ends_at, c.window_ends_at),
        updated_at     = now()
  returning c.value into v_value;
  return v_value;
end;
$$;

revoke all on function public.increment_usage_counter(text, timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.increment_usage_counter(text, timestamptz, bigint)
  to service_role;
```

**RLS 说明：** 开启 RLS 且**不添加任何 policy**，等于除 service role 外无人可读写。
这是刻意的 —— 浏览器若能写自己的计数器，就能把自己的额度清零。

---

### §3.2 迁移二 —— 记账表

**作用：** 每一次公司出钱的调用写一行，回答「这笔钱花在谁身上」。

**设计要点：**

- **这张表在结构上就装不下任何密钥。** 没有任何一列可以容纳，**也不要为了排查问题加**。
  记账表是泄漏的密钥存活最久的地方。
- `byok` 可为 null 是刻意的：null 表示「不确定」。错误地写 `false` 会被读成「公司付了这笔钱」。
- `kind` 的 check 约束限定三个值。**若将来需要第四类（例如记录服务不可用），
  需要单独一次迁移修改约束** —— 现在不要预留。

```sql
create table if not exists public.usage_events (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid,
  kind            text not null check (kind in ('llm', 'search', 'breaker')),
  path            text,
  provider        text,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  thinking_tokens integer,
  latency_ms      integer,
  ok              boolean not null,
  byok            boolean,
  surface         text,
  query_count     integer
);

create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

create index if not exists usage_events_kind_created_idx
  on public.usage_events (kind, created_at desc);

alter table public.usage_events enable row level security;

revoke all on table public.usage_events from anon, authenticated;
```

**注意：** `user_id` 是裸 `uuid`，**没有** 外键约束到 `auth.users`。
这是刻意的：记账行的价值在于「花了钱」这个事实，不应因用户注销而级联删除。
如果你们的规范要求外键，请回传告知，我们会评估影响后再改，**不要自行添加**。

---

### §3.3 迁移三 —— 套餐列 + 触发器 + 列级权限 ⚠️

**这是唯一有覆盖风险的迁移。执行前必须完成 §2.2。**

**作用三件事：**

1. 给 `public.profiles` 加四列：套餐、试用开始、试用结束、套餐更新时间
2. 重新声明 `handle_new_user`，让**新注册用户**自动获得 14 天试用
3. 用列级权限禁止浏览器端修改这四列

**关于默认值的刻意设计：**

`plan` 的列默认值是 `'free'` 而**不是** `'trial'`。
列默认值决定的是**执行这条语句时已存在的行**的取值。
若设为 `'trial'`，会把所有现有用户在迁移那一刻静默转成 14 天试用 —— 那是一个产品决定，
不应该由一条 DDL 顺带做掉。新用户的试用由触发器发放。

**关于列级权限：**

`profiles` 上现有的三条 policy 允许用户 select / insert / update **自己那一行**。
其中 update policy 会让浏览器能写自己的 `plan`。
Postgres 的 RLS policy **无法做列级限制**，所以正确的工具是列权限（`revoke update (col)`）。
**现有的行级 policy 一条都不动**，其他所有列的行为完全不变。
service role 同时绕过 RLS 和列权限，这正是「管理员手工设置套餐」所需要的。

```sql
-- ── 1. 四个新列 ──
alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'trial', 'paid')),
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at    timestamptz,
  add column if not exists plan_updated_at  timestamptz;

comment on column public.profiles.plan is
  'free | trial | paid. Set by hand (service role) today; the future Stripe webhook writes here. Never writable by anon or authenticated - see the column grants below.';
```

```sql
-- ── 2. 触发器函数 ⚠️ 执行前请完成 §2.2 的比对 ──
--
-- 整体重新声明而非局部修改：这个函数是 security definer + set search_path，
-- 这是安全编辑它的唯一方式。
-- 函数体 = 原有的「插入 user_id」+ 四个 plan 字段。
-- on_auth_user_created 触发器本身无需任何改动。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    user_id, plan, trial_started_at, trial_ends_at, plan_updated_at
  )
  values (
    new.id, 'trial', now(), now() + interval '14 days', now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
```

```sql
-- ── 3. 列级权限 ──
revoke update (plan, trial_started_at, trial_ends_at, plan_updated_at)
  on public.profiles from anon, authenticated;
```

---

## §4 执行后的验证 —— 全部是读操作（最后一条会写一行临时数据并立即删除）

**请把全部输出回传。**

### 4.1 四个新列存在且约束正确

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('plan', 'trial_started_at', 'trial_ends_at', 'plan_updated_at')
order by column_name;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass and contype = 'c';
```

**期望：** 四行；`plan` 的 `column_default` 为 `'free'::text`、`is_nullable` 为 `NO`；
约束里能看到 `CHECK (plan = ANY (ARRAY['free', 'trial', 'paid']))`。

### 4.2 列级权限已收回

```sql
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('plan', 'trial_started_at', 'trial_ends_at', 'plan_updated_at')
  and grantee in ('anon', 'authenticated');
```

**期望：返回 0 行。** 若有 `UPDATE` 行 → 权限没收回，浏览器可以自己升级套餐，**必须处理后才能上线**。

### 4.3 两张表存在且 RLS 已开启

```sql
select c.relname, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('usage_counters', 'usage_events');
```

**期望：** 两行，`rls_enabled` 均为 `true`，`policy_count` 均为 **0**（0 是正确的，不是遗漏）。

### 4.4 ⭐ 自增函数实测 —— 这是整套里最重要的一条验证

```sql
select public.increment_usage_counter('handoff:selftest', null, 1) as should_be_1;
select public.increment_usage_counter('handoff:selftest', null, 1) as should_be_2;
select public.increment_usage_counter('handoff:selftest', null, 5) as should_be_7;
select key, value from public.usage_counters where key = 'handoff:selftest';
delete from public.usage_counters where key = 'handoff:selftest';
```

**期望：依次返回 1、2、7**，然后表里那一行 `value = 7`，最后删除。

**为什么这条最重要：** 这个函数的正确性在于「累加而不是覆盖」。
如果它写错成覆盖，三次调用会返回 1、1、5 —— **额度系统会永远认为用户没用过**，
而且任何代码层面的测试都发现不了，因为那要真的连数据库才能暴露。
**这三个数字是唯一能证明它对的证据。**

### 4.5 触发器函数的当前定义（与 §2.2 的备份对比）

```sql
select pg_get_functiondef(oid) as definition_after
from pg_proc
where proname = 'handle_new_user' and pronamespace = 'public'::regnamespace;
```

**期望：** 与 §3.3 提供的版本一致。若你们做过合并，请回传合并后的版本。

---

## §5 回滚

**按此顺序执行可完全撤销**（除触发器函数外，它需要 §2.2 的备份）。

```sql
drop function if exists public.increment_usage_counter(text, timestamptz, bigint);
drop table if exists public.usage_events;
drop table if exists public.usage_counters;

alter table public.profiles
  drop column if exists plan,
  drop column if exists trial_started_at,
  drop column if exists trial_ends_at,
  drop column if exists plan_updated_at;
```

**触发器函数的回滚：** 执行你在 §2.2 保存的那段 `pg_get_functiondef` 输出即可。
**如果没有保存 §2.2 的输出，这一项无法回滚** —— 这就是那一步不能跳过的原因。

**注意：** 回滚会丢失 `usage_events` 和 `usage_counters` 里的所有数据。
迁移刚执行时这两张表是空的，因此立即回滚无损失。

---

## §6 请回传给我们的内容

按重要性排序：

1. **§2.2 的完整输出** —— 现有 `handle_new_user` 的定义（这决定了迁移三能否直接执行）
2. **§2.4 的用户数**
3. **§4.4 的三个数字**（1 / 2 / 7）—— 这是「记账系统真的能工作」的唯一证据
4. **§4.2 是否返回 0 行**
5. 执行过程中的**任何报错原文**（不要自行修改 SQL 绕过，请原样回传）
6. §2.1 / §2.3 / §4.1 / §4.3 的输出（用于留档比对）

---

## §7 与你们后端 harness 的交互 —— 已知影响面

| 你们那边如果有… | 影响 | 处理 |
|---|---|---|
| 自定义的 `handle_new_user` 逻辑 | **会被覆盖** | §2.2 必须先做；有差异则不要执行迁移三，回传给我们合并 |
| 以 `authenticated` 身份写 `profiles` 的代码 | **无影响** | 只收回了四个**新增**列的写权限，其余列不变 |
| 读 `profiles` 全部列的代码 | **无影响** | 读权限未改动；新列会以 `free` / `null` 出现 |
| 依赖 `profiles` 列顺序或 `select *` 的代码 | **可能受影响** | 新列会出现在 `select *` 的末尾。若有硬编码列位置的逻辑请自查 |
| 名为 `usage_counters` / `usage_events` / `increment_usage_counter` 的现有对象 | **会冲突** | §2.3 会查出来；有冲突请停止并回传 |
| 自动化的 schema diff / drift 检测 | **会报告变更** | 这是预期内的，变更清单见 §1 |
| 数据库 migration 版本管理工具 | 需要登记 | 三个文件名即为版本号：`20260904000000` / `20260904000100` / `20260904000200` |

---

## §8 时间与依赖

- **这三个迁移不阻塞你们任何现有工作**，也不需要停机
- **执行后可以立即回滚**，无数据损失
- 我们这边的分支 `freemium-system-key` **尚未合并、尚未部署**
- 迁移执行后，我们才能验证 5 项目前无法验证的功能（额度、试用到期、记账、限流、熔断）
- **我们不会在验证通过前部署**

---

**问题联系：** 通过本文档的提供方（Peer 前端/服务端侧）。
任何报错请**原样回传**，不要自行修改 SQL —— 这些语句经过逐条设计，
一处「顺手改对」的修改可能改变安全语义（例如把 `revoke` 写成 `grant`，或把累加写成覆盖）。
