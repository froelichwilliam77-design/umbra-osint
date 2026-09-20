# Umbra target schema

Umbra loads three schema layers:

1. **`wmn-data.json`** — WhatsMyName registry (hundreds of platforms). Sync with `npm run sync:wmn`.
2. **`sites.curated.yaml`** — extra handle targets, extractors, and overrides.
3. **`oracles.yaml`** — silent email registration oracles (no SMTP, no password-reset mail).

## Handle site (WhatsMyName-compatible)

```json
{
  "name": "GitHub (User)",
  "uri_check": "https://api.github.com/users/{account}",
  "uri_pretty": "https://github.com/{account}",
  "e_code": 200,
  "e_string": "\"login\":",
  "m_code": 404,
  "m_string": "Not Found",
  "cat": "coding",
  "known": ["octocat"],
  "protection": ["cloudflare"]
}
```

Classification is **dual-condition**:

- **found** if `status == e_code` AND `e_string` is in the body (empty string = ignore that half).
- **miss** if `status == m_code` AND `m_string` is in the body.
- Both true → **escalate**. Neither → **escalate**.
- `403` / `429` / CAPTCHA / WAF signatures → **blocked**, never a miss.
- Redirects to login / explore / generic home → **miss** with a reason.

`{account}` is replaced with the handle. Optional `{account}` also works in `post_body` and header values.

## Curated overlay

```yaml
sites:
  - name: Example
    uri_check: https://example.com/{account}
    e_code: 200
    e_string: "profile"
    m_code: 404
    m_string: "not found"
    cat: social
extractors:
  - site: GitHub (User)
    kind: json
    avatar: avatar_url
    bio: bio
    followers: followers
    displayName: name
```

## Email oracles

Oracles must be silent: they read public signup / login / profile endpoints only. Umbra will not call password-reset endpoints that email the subject.

```yaml
oracles:
  - id: gravatar
    name: Gravatar
    category: identity
    handler: gravatar
```
