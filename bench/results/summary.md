| Variant | Calls | Input tok | Output tok | Cost (API-equiv) | Wall time | Failed parts | Fidelity | Coherence | Craft | Overall |
|---|---|---|---|---|---|---|---|---|---|---|
| text | 50 | 72,920 (+0%) | 44,806 (+0%) | $1.48 (+0%) | 2991s | 0 | 8.6 | 6.9 | 7.5 | 7.7 |
| shot-half | 50 | 83,958 (+15%) | 42,867 (-4%) | $1.53 (+3%) | 5659s | 0 | 8.6 | 7.3 | 7.4 | 7.8 |
| shot-full | 50 | 107,619 (+48%) | 43,520 (-3%) | $1.73 (+17%) | 5628s | 0 | 8.4 | 6.5 | 7.1 | 7.3 |

| Prompt | Variant | Parts | Input tok | Output tok | Wall | Overall |
|---|---|---|---|---|---|---|
| bicycle | text | 8 | 11688 | 7859 | 77s | 8.5 |
| bicycle | shot-half | 8 | 13461 | 6986 | 1282s | 8.2 |
| bicycle | shot-full | 8 | 17253 | 7869 | 1264s | 8.2 |
| cat | text | 9 | 13183 | 9226 | 95s | 7.5 |
| cat | shot-half | 9 | 15158 | 8920 | 372s | 8.3 |
| cat | shot-full | 9 | 19425 | 9312 | 378s | 7.5 |
| cube | text | 5 | 7117 | 2962 | 521s | 7.0 |
| cube | shot-half | 5 | 8217 | 3205 | 960s | 7.7 |
| cube | shot-full | 5 | 10581 | 2979 | 1005s | 7.2 |
| fruit | text | 11 | 16482 | 8577 | 873s | 7.5 |
| fruit | shot-half | 11 | 18910 | 9081 | 406s | 7.7 |
| fruit | shot-full | 11 | 24105 | 8789 | 389s | 7.0 |
| landscape | text | 9 | 12804 | 8493 | 738s | 8.3 |
| landscape | shot-half | 9 | 14802 | 6609 | 1332s | 7.0 |
| landscape | shot-full | 9 | 19066 | 6527 | 1314s | 6.5 |
| lighthouse | text | 8 | 11646 | 7689 | 688s | 7.2 |
| lighthouse | shot-half | 8 | 13410 | 8066 | 1308s | 7.7 |
| lighthouse | shot-full | 8 | 17189 | 8044 | 1279s | 7.7 |
