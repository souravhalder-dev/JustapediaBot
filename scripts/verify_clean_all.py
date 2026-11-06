import json
import sys
sys.path.append('scripts')
from test_full_clean import clean_wikitext_full
from audit_duplicates import check_content, api_call

with open('affected_articles.json', 'r', encoding='utf-8') as f:
    affected = json.load(f)

print(f"Testing cleaner on all {len(affected)} affected articles...")

titles = list(affected.keys())
remaining_count = 0
fixed_count = 0

batch_size = 50
for i in range(0, len(titles), batch_size):
    batch = titles[i:i+batch_size]
    joined_titles = "|".join(batch)
    url = f"https://justapedia.org/api.php?action=query&prop=revisions&titles={joined_titles}&rvprop=ids|content&rvslots=main&format=json"
    data = api_call(url)
    pages = data.get("query", {}).get("pages", {})
    for pid, p in pages.items():
        if pid == "-1":
            continue
        t = p.get("title", "")
        content = p.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("*", "")
        cleaned = clean_wikitext_full(content)
        after_issues = check_content(t, cleaned)
        if after_issues:
            remaining_count += 1
            print(f"Remaining issue on [{t}]: {after_issues}")
        else:
            fixed_count += 1

print(f"\nFinal Results: {fixed_count} fully cleaned, {remaining_count} remaining.")
