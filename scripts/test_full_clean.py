import json
import re
import urllib.parse

with open("affected_articles.json", "r", encoding="utf-8") as f:
    affected = json.load(f)

print(f"Loaded {len(affected)} affected articles.")

def clean_wikitext_full(wikitext: str) -> str:
    cleaned = wikitext

    # 1. Relocate templates outside </ref> back inside <ref>
    # Handle {{webarchive}}, {{wayback}}, {{dead link}}
    def move_wa_inside(m):
        ref_open, inner, ref_close, trailing_wa = m.groups()
        clean_inner = re.sub(r'\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}', '', inner, flags=re.I).rstrip()
        wa_match = re.search(r'\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}', trailing_wa, re.I)
        wa_tag = wa_match.group(0).strip() if wa_match else ""
        if wa_tag and not re.search(r'\{\{\s*(?:webarchive|wayback)', clean_inner, re.I):
            clean_inner = f"{clean_inner} {wa_tag}"
        return f"{ref_open}{clean_inner}{ref_close}"

    cleaned = re.sub(
        r'(<ref(?:\s+[^>]*)?>)([\s\S]*?)(</ref\s*>)((?:\s*\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\})+)',
        move_wa_inside,
        cleaned,
        flags=re.I
    )

    def move_dl_inside(m):
        ref_open, inner, ref_close, trailing_dl = m.groups()
        has_archive = bool(
            re.search(r'\|\s*archive-?url\s*=\s*https?://', inner, re.I) or
            re.search(r'\{\{\s*(?:webarchive|wayback)', inner, re.I)
        )
        if has_archive:
            # Obsolete dead link, strip completely
            return f"{ref_open}{inner}{ref_close}"
        
        dl_match = re.search(r'\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}', trailing_dl, re.I)
        dl_tag = dl_match.group(0).strip() if dl_match else ""
        clean_inner = re.sub(r'\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}', '', inner, flags=re.I).rstrip()
        if dl_tag and not re.search(r'\{\{\s*dead[ _]?link', clean_inner, re.I):
            clean_inner = f"{clean_inner} {dl_tag}"
        return f"{ref_open}{clean_inner}{ref_close}"

    cleaned = re.sub(
        r'(<ref(?:\s+[^>]*)?>)([\s\S]*?)(</ref\s*>)((?:\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\})+)',
        move_dl_inside,
        cleaned,
        flags=re.I
    )

    # Strip dead link immediately before or after webarchive / wayback
    cleaned = re.sub(
        r'\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}\s*(\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\})',
        r'\1',
        cleaned,
        flags=re.I
    )
    cleaned = re.sub(
        r'(\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\})\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}',
        r'\1',
        cleaned,
        flags=re.I
    )

    # 2. Inside every <ref>...</ref>, sanitize:
    def sanitize_ref_inner(m):
        ref_open, inner, ref_close = m.groups()
        has_archive = bool(
            re.search(r'\|\s*archive-?url\s*=\s*https?://', inner, re.I) or
            re.search(r'\{\{\s*(?:webarchive|wayback)', inner, re.I)
        )
        if has_archive:
            # Strip any {{dead link}} inside ref
            inner = re.sub(r'\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}', '', inner, flags=re.I)

        # Deduplicate multiple {{dead link}} inside ref: keep at most one
        dl_matches = list(re.finditer(r'\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}', inner, flags=re.I))
        if len(dl_matches) > 1:
            first_dl = dl_matches[0].group(0)
            inner = re.sub(r'\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}', '', inner, flags=re.I)
            inner = f"{inner.rstrip()} {first_dl}"

        # Deduplicate multiple {{webarchive}} or {{wayback}} inside ref: keep at most ONE
        wa_matches = list(re.finditer(r'\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}', inner, flags=re.I))
        if len(wa_matches) > 1:
            first_wa = wa_matches[0].group(0)
            inner = re.sub(r'\s*\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}', '', inner, flags=re.I)
            inner = f"{inner.rstrip()} {first_wa}"

        return f"{ref_open}{inner}{ref_close}"

    cleaned = re.sub(
        r'(<ref(?:\s+[^>]*)?>)([\s\S]*?)(</ref\s*>)',
        sanitize_ref_inner,
        cleaned,
        flags=re.I
    )

    # 3. Clean any consecutive identical templates in main body text
    cleaned = re.sub(r'(\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}\s*)\1+', r'\1', cleaned, flags=re.I)
    cleaned = re.sub(r'(\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}\s*)\1+', r'\1', cleaned, flags=re.I)

    return cleaned

# Test on scripts/audit_duplicates.py checks
from audit_duplicates import check_content, api_call

print("Testing cleaner on 20 sample articles with issues...")
batch_titles = list(affected.keys())[:20]
url = f"https://justapedia.org/api.php?action=query&prop=revisions&titles={'|'.join([urllib.parse.quote(t) for t in batch_titles])}&rvprop=ids|content&rvslots=main&format=json"

import urllib.parse
data = api_call(f"https://justapedia.org/api.php?action=query&prop=revisions&titles={'|'.join(batch_titles)}&rvprop=ids|content&rvslots=main&format=json")
pages = data.get("query", {}).get("pages", {})

all_cleansed = True
for pid, p in pages.items():
    if pid == "-1": continue
    t = p.get("title", "")
    content = p.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("*", "")
    before_issues = check_content(t, content)
    cleaned = clean_wikitext_full(content)
    after_issues = check_content(t, cleaned)
    print(f"[{t}]: Before: {len(before_issues)} issues -> After: {len(after_issues)} issues")
    if after_issues:
        all_cleansed = False
        print(f"   REMAINING ISSUES on {t}:", after_issues)

print(f"\nAll sample articles completely resolved? {all_cleansed}")
