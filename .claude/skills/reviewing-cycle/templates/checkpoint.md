# <ITEM> — <ROLE> checkpoint

Role <A|B|C>. Model: <the model this ran on>. Worktree `<path>`, detached from `<sha>`. No push, no branch; touched only `<files>`.

## 1. Commits (in order)

| | hash | |
|---|---|---|
| 1 | `<sha>` | `<message>` — <what it holds> |

## 2. The rules as built

1. **<Rule.>** <How, and where.>

## 3. Tests

<Added (named); re-aimed (named, with the reason); none deleted or weakened.>

## 4. Gates (from `<dir>`, on the final tree)

| gate | result |
|---|---|
| typecheck | <exit> |
| lint | <errors> / <warnings> |
| touched tests | <passed> |
| full suite | <files> + <skipped> / <passed> + <skipped>, <failed> |
| build | <exit> |

## 5. Mutations (own, final tree; sha256 before = after)

| id | rule | disabled | red |
|---|---|---|---|
| M1 | 1 | <what was broken> | <n> tests |

## 6. Measurements (before → after, on an invented input)

<The numbers the brief asked for.>

## 7. For the manager

<Anything unsettled; files needed that were not yours; follow-ups by mechanism.>
