import urllib.request
import json
import re
import difflib

url = 'https://justapedia.org/api.php?action=query&prop=revisions&titles=%22Shotgun%20Tom%22%20Kelly&rvprop=content&rvslots=main&format=json'
payload = json.dumps({'url': url, 'method': 'GET'}).encode('utf-8')
req = urllib.request.Request('http://127.0.0.1:5005', data=payload, headers={'Content-Type': 'application/json'})
res = json.loads(urllib.request.urlopen(req).read())
pages = res.get('data', {}).get('query', {}).get('pages', {})
orig = list(pages.values())[0]['revisions'][0]['slots']['main']['*']

def clean_wikitext(text):
    cleaned = text
    
    # 1. Relocate templates placed outside </ref> back inside <ref>
    def move_inside(m):
        ref_open = m.group(1)
        inner = m.group(2)
        trailing_tags = m.group(3)
        return f"{ref_open}{inner.rstrip()} {trailing_tags.strip()}</ref>"

    cleaned = re.sub(
        r'(<ref\b[^>/]*>)([\s\S]*?)</ref\s*>\s*((?:\{\{(?:webarchive|dead[ _]?link|wayback)[^}]*\}\}\s*)+)',
        move_inside,
        cleaned,
        flags=re.IGNORECASE
    )

    # 2. Inside each <ref>...</ref>, process templates:
    def sanitize_ref(m):
        open_tag = m.group(1)
        body = m.group(2)
        close_tag = m.group(3)

        # Check if ref has archive
        has_archive = bool(
            re.search(r'\|\s*archive-?url\s*=\s*https?://', body, re.I) or
            re.search(r'\{\{\s*(?:webarchive|wayback)', body, re.I)
        )

        # If has archive, remove any {{dead link...}}
        if has_archive:
            body = re.sub(r'\s*\{\{\s*dead[ _]?link[^}]*\}\}', '', body, flags=re.I)

        # Deduplicate consecutive or multiple {{webarchive}}
        webarchives = list(re.finditer(r'\{\{\s*(?:webarchive|wayback)[^}]*\}\}', body, re.I))
        if len(webarchives) > 1:
            seen = set()
            new_body = []
            last_idx = 0
            for wa in webarchives:
                tpl = wa.group(0)
                norm_tpl = re.sub(r'\s+', ' ', tpl.lower())
                start, end = wa.span()
                new_body.append(body[last_idx:start])
                if norm_tpl not in seen:
                    seen.add(norm_tpl)
                    new_body.append(tpl)
                last_idx = end
            new_body.append(body[last_idx:])
            body = ''.join(new_body)

        # Deduplicate multiple {{dead link}}
        deadlinks = list(re.finditer(r'\{\{\s*dead[ _]?link[^}]*\}\}', body, re.I))
        if len(deadlinks) > 1:
            seen_dead = False
            new_body = []
            last_idx = 0
            for dl in deadlinks:
                tpl = dl.group(0)
                start, end = dl.span()
                new_body.append(body[last_idx:start])
                if not seen_dead:
                    seen_dead = True
                    new_body.append(tpl)
                last_idx = end
            new_body.append(body[last_idx:])
            body = ''.join(new_body)

        return f"{open_tag}{body}{close_tag}"

    cleaned = re.sub(
        r'(<ref\b[^>/]*>)([\s\S]*?)(</ref\s*>)',
        sanitize_ref,
        cleaned,
        flags=re.IGNORECASE
    )

    # 3. Clean any consecutive identical templates in main text
    cleaned = re.sub(r'(\{\{dead[ _]?link[^}]*\}\}\s*)\1+', r'\1', cleaned, flags=re.I)
    cleaned = re.sub(r'(\{\{webarchive[^}]*\}\}\s*)\1+', r'\1', cleaned, flags=re.I)

    return cleaned

cleaned = clean_wikitext(orig)
diff = list(difflib.unified_diff(orig.splitlines(), cleaned.splitlines(), lineterm=''))
print(f"Diff lines count: {len(diff)}")
for line in diff[:30]:
    print(line)
