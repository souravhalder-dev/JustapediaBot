import urllib.request
import urllib.parse
import json
import re
import sys

def api_call(url, params=None, method="GET", data=None):
    payload = json.dumps({"url": url, "method": method, "data": data, "params": params}).encode("utf-8")
    req = urllib.request.Request("http://127.0.0.1:5005", data=payload, headers={"Content-Type": "application/json"})
    res = json.loads(urllib.request.urlopen(req, timeout=60).read())
    return res.get("data", {})

def get_all_iabot_titles():
    titles = set()
    uccontinue = None
    while True:
        url = "https://justapedia.org/api.php?action=query&list=usercontribs&ucuser=InternetArchiveBot&uclimit=500&ucprop=title&format=json"
        if uccontinue:
            url += f"&uccontinue={uccontinue}"
        data = api_call(url)
        contribs = data.get("query", {}).get("usercontribs", [])
        for c in contribs:
            titles.add(c["title"])
        if "continue" in data:
            uccontinue = data["continue"].get("uccontinue")
        else:
            break
    return sorted(list(titles))

# Accurate, non-overlapping single-ref regexes
OUTSIDE_REF_RE = re.compile(r'</ref\s*>\s*(\{\{(?:webarchive|dead[ _]?link|wayback)[^}]*\}\})', re.IGNORECASE)
CONSECUTIVE_DUP_RE = re.compile(r'(\{\{(?:webarchive|dead[ _]?link|wayback)[^}]*\}\})\s*(\{\{(?:webarchive|dead[ _]?link|wayback)[^}]*\}\})', re.IGNORECASE)

DEAD_WITH_ARCHIVE_1 = re.compile(r'<ref\b[^>/]*>(?:(?!</?ref)[\s\S])*?(?:archive-?url\s*=\s*https?://|\{\{\s*(?:webarchive|wayback))(?:(?!</?ref)[\s\S])*?\{\{\s*dead[ _]?link(?:(?!</?ref)[\s\S])*?</ref>', re.I)
DEAD_WITH_ARCHIVE_2 = re.compile(r'<ref\b[^>/]*>(?:(?!</?ref)[\s\S])*?\{\{\s*dead[ _]?link(?:(?!</?ref)[\s\S])*?(?:archive-?url\s*=\s*https?://|\{\{\s*(?:webarchive|wayback))(?:(?!</?ref)[\s\S])*?</ref>', re.I)

MULTIPLE_WEBARCHIVE_IN_REF = re.compile(r'<ref\b[^>/]*>(?:(?!</?ref)[\s\S])*?\{\{\s*(?:webarchive|wayback)[^}]*\}\}(?:(?!</?ref)[\s\S])*?\{\{\s*(?:webarchive|wayback)[^}]*\}\}(?:(?!</?ref)[\s\S])*?</ref>', re.I)
MULTIPLE_DEADLINK_IN_REF = re.compile(r'<ref\b[^>/]*>(?:(?!</?ref)[\s\S])*?\{\{\s*dead[ _]?link[^}]*\}\}(?:(?!</?ref)[\s\S])*?\{\{\s*dead[ _]?link[^}]*\}\}(?:(?!</?ref)[\s\S])*?</ref>', re.I)

def check_content(title, content):
    issues = []
    
    outside = OUTSIDE_REF_RE.findall(content)
    if outside:
        issues.append(f"Template outside </ref>: {len(outside)} found")
        
    consec = CONSECUTIVE_DUP_RE.findall(content)
    if consec:
        issues.append(f"Consecutive duplicate templates: {len(consec)} found")
        
    dwa1 = DEAD_WITH_ARCHIVE_1.findall(content)
    dwa2 = DEAD_WITH_ARCHIVE_2.findall(content)
    dwa_total = len(dwa1) + len(dwa2)
    if dwa_total > 0:
        issues.append(f"Dead link on ref with archive: {dwa_total} found")
        
    m_web = MULTIPLE_WEBARCHIVE_IN_REF.findall(content)
    if m_web:
        issues.append(f"Multiple webarchive in same ref: {len(m_web)} found")
        
    m_dead = MULTIPLE_DEADLINK_IN_REF.findall(content)
    if m_dead:
        issues.append(f"Multiple dead links in same ref: {len(m_dead)} found")
        
    return issues

def audit_all():
    titles = get_all_iabot_titles()
    print(f"Auditing {len(titles)} titles edited by InternetArchiveBot...")
    
    affected = {}
    batch_size = 50
    
    for i in range(0, len(titles), batch_size):
        batch = titles[i:i+batch_size]
        url = f"https://justapedia.org/api.php?action=query&prop=revisions&titles={'|'.join(batch)}&rvprop=ids|content&rvslots=main&format=json"
        try:
            data = api_call(url)
            pages = data.get("query", {}).get("pages", {})
            for pid, page_info in pages.items():
                if pid == "-1":
                    continue
                t = page_info.get("title", "")
                revs = page_info.get("revisions", [])
                if not revs:
                    continue
                content = revs[0].get("slots", {}).get("main", {}).get("*", "")
                revid = revs[0].get("revid", 0)
                issues = check_content(t, content)
                if issues:
                    affected[t] = {
                        "revid": revid,
                        "issues": issues,
                        "content_len": len(content)
                    }
        except Exception as e:
            print(f"Error checking batch {i}: {e}")
            
    print(f"\nAudit complete! Found {len(affected)} articles with issues out of {len(titles)}.")
    
    with open("affected_articles.json", "w", encoding="utf-8") as f:
        json.dump(affected, f, indent=2, ensure_ascii=False)
        
    summary = {}
    for t, info in affected.items():
        for iss in info['issues']:
            cat = iss.split(':')[0]
            summary[cat] = summary.get(cat, 0) + 1
            
    print("Issue Breakdown:")
    for cat, cnt in summary.items():
        print(f"  - {cat}: {cnt} articles")

if __name__ == "__main__":
    audit_all()
