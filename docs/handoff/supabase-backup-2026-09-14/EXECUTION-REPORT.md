# Supabase 迁移执行回执 — 2026-09-14

项目:`gdakokshfjqljddlrkrh`(线上与本地共用同一个库)。执行方式:Supabase MCP。

## 执行前检查(交接单 §2)

| 项 | 结果 |
|---|---|
| §2.1 profiles 字段 | 18 列,无 plan/trial 四列;另缺 schema.sql 第 78–142 行的扩展列、authorised_countries |
| §2.2 handle_new_user | 与交接单假设一致(只插入 user_id)。原定义备份:`handle_new_user.before.sql` |
| §2.3 命名冲突 | 0 行 |
| §2.4 现有用户数 | **5**(迁移后均为 `free`,未补试用) |
| §2.5 policies | 3 条:read / insert / update own profile |
| 追加:表级权限 | **anon 与 authenticated 均持有 profiles 的表级 UPDATE、INSERT** |

## 已执行(按顺序,Supabase 迁移记录名)

1. `profiles_extension_columns_backfill` — schema.sql 第 78–142 行(修复 Hourly digest dispatch,自 9/3 起的 500)
2. `opportunity_pools` — main 分支未应用的迁移 20260727000000
3. `authorised_countries` — main 分支未应用的迁移 20260731000000
4. `usage_counters` — 交接单迁移一,原样
5. `usage_events` — 交接单迁移二,原样
6. `profile_plan` — 交接单迁移三,原样,**除最后一条 revoke**
7. `profile_plan_column_grants` — **替代**迁移三最后一条 revoke(见下)

## 与交接单的唯一偏差

交接单的 `revoke update (plan, trial_started_at, trial_ends_at, plan_updated_at) on public.profiles from anon, authenticated;`
在本库无效:两个角色持有表级 UPDATE,列级 revoke 删不掉表级授权,用户可经 PostgREST 把自己改成 `plan='paid'`。

实际执行:

```sql
revoke update, insert on public.profiles from anon, authenticated;
-- 然后按当时的实际列清单,对 authenticated 授予除四个套餐列外所有列的 update 与 insert
```

INSERT 一并处理:`PUT /api/profile` 走 upsert,需要 INSERT 与 UPDATE 同时覆盖同一批列。

**请同步修改分支上的 `20260904000200_profile_plan.sql`**,否则仓库与线上不一致。
**以后 profiles 每新增一个用户可编辑的列**,必须补 `grant update (col), insert (col) on public.profiles to authenticated;`,否则保存报 permission denied。

## 执行后验证(交接单 §4)

| 项 | 结果 |
|---|---|
| §4.1 四列与约束 | 存在;plan 为 `not null default 'free'`;`profiles_plan_check` = free/trial/paid |
| §4.2 权限(以 authenticated 身份实测,均在事务内) | `update plan` → **42501 permission denied** ✓;`insert (user_id, plan)` → **42501 permission denied** ✓;`update current_project` → 成功 ✓;`insert (user_id, current_project)` → 被 RLS 拦截(说明列权限在,行策略生效)✓;表级 UPDATE/INSERT 剩余:0 行 ✓ |
| §4.3 RLS | usage_counters / usage_events / opportunity_pools:rls=true,policy=0 ✓ |
| §4.4 计数自检 | **1 → 2 → 7** ✓,测试行已删除 |
| §4.5 handle_new_user | 含 14 天试用逻辑;security definer;search_path=public ✓ |
| Hourly digest dispatch(手动触发) | **HTTP 200**,dispatched 0 / skipped 5 / failed 0(非各用户设定的发送时刻) |

## 回滚(按顺序)

```sql
-- 权限
grant update, insert on public.profiles to anon, authenticated;
-- 触发器函数:执行 handle_new_user.before.sql
-- 迁移三
alter table public.profiles
  drop column if exists plan, drop column if exists trial_started_at,
  drop column if exists trial_ends_at, drop column if exists plan_updated_at;
-- 迁移二、一
drop table if exists public.usage_events;
drop function if exists public.increment_usage_counter(text, timestamptz, bigint);
drop table if exists public.usage_counters;
```

main 分支的扩展列、opportunity_pools、authorised_countries 是线上代码本来就依赖的,不应回滚。
