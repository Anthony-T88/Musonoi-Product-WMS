"""Offline geometry-only extraction. Requires pdfplumber; never imports PDF stock figures.
Run from project root: python scripts/digitize-stock-map.py "Map Copper Cathodes.pdf"
Outputs a reviewed geometry JSON and additive migration. Runtime has no Python dependency.
"""
import hashlib
import json
import re
import sys
from pathlib import Path
import pdfplumber

source = Path(sys.argv[1])
with pdfplumber.open(source) as pdf:
    assert len(pdf.pages) == 1
    page = pdf.pages[0]
    words = [w for w in page.extract_words(x_tolerance=.4, y_tolerance=.4)
             if re.fullmatch(r'P[1-5]-\d{1,2}', w['text'])]
    expected = {f'P{r}-{i}' for r, count in [(1,46),(2,29),(3,34),(4,22),(5,34)] for i in range(1,count+1)}
    assert len(words) == 165 and {w['text'] for w in words} == expected
    # Column borders measured from the PDF's vector rectangles, not a new site plan.
    def bounds(w):
        code = w['text']; n = int(code.split('-')[1]); r = code[:2]
        if r in ('P1','P2'): return 439.72, 510.82
        if r == 'P5': return (177.68,266.81) if n >= 18 else (266.75,349.87)
        return (94.86,148.88) if r == 'P3' and n >= 20 else (148.88,222.23)
    def geom(x,y,width,height):
        # Crop whitespace; scale drawing points by four for legible SVG typography.
        return dict(x=round((x-60)*4,2), y=round((y-75)*4,2), width=round(width*4,2), height=round(height*4,2))
    cells = []
    for w in sorted(words, key=lambda w:(int(w['text'][1]),int(w['text'].split('-')[1]))):
        x0,x1 = bounds(w)
        cells.append(dict(code=w['text'], **geom(x0,w['top']-1.28,x1-x0,6.60)))
    # Rectangles below are source-vector bounds; labels carry no source inventory data.
    feature_bounds = [
        ('LP1','LOADING','Loading Point 1',381.43,135.356,31.8,114.384),
        ('LP2','LOADING','Loading Point 2',349.75,276.53,31.8,107.64),
        ('LP3','LOADING','Loading Point 3',349.75,404.206,31.8,100.944),
        ('LP4','LOADING','Loading Point 4',349.75,531.916,31.8,100.944),
        ('CA1','CHECKING','Checking Area 1',222.17,657.576,127.7,30.144),
        ('CA2','CHECKING','Checking Area 2',67.68,657.576,110.06,30.144),
        ('CTLP','CONTAINER','Container Truck Loading Point',117.14,115.2,31.8,94.22),
        ('OFFICE','OFFICE','Export Office',511,301.5,32.24,14.5),
        ('OFF-PROD-N','OFFICE','Production Office',67.68,95.04,27.24,188.45),
        ('OFF-PROD-S','OFFICE','Production Office',67.68,505.03,27.24,94.35),
        ('ROAD','ROAD','Road',67.68,696.24,506.52,16.68),
        ('ROAD-E','ROAD','Road',543.24,82.32,30.96,543.82),
    ]
    features = [dict(code=c,kind=k,label=l,**geom(x,y,w,h)) for c,k,l,x,y,w,h in feature_bounds]
layout = dict(source_name=source.name, source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
              status='DIGITIZED_PENDING_REVIEW', width=2080, height=2580,
              derivation='PDF vector borders and 165 exact slot labels; crop origin (60,75)pt, scale 4. Not surveyed coordinates. No stock figures/customer colors imported.',
              cells=cells, features=features)
Path('db/stock-map-layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def sql(s): return "'"+str(s).replace("'","''")+"'"
lines = ['-- Geometry only from the supplied site PDF. No inventory, customers or capacities are inserted.',
         '-- Source SHA256: '+layout['source_sha256']]
for c in cells:
    lines.append('UPDATE stock_map_cells SET '+','.join(f'{k}={c[k]}' for k in ['x','y','width','height'])+' WHERE code='+sql(c['code'])+';')
for f in features:
    cols=['code','kind','label','x','y','width','height']
    lines.append('INSERT INTO stock_map_features('+','.join(cols)+') VALUES('+','.join(sql(f[k]) if k in cols[:3] else str(f[k]) for k in cols)+') ON CONFLICT(code) DO UPDATE SET '+','.join(k+'=excluded.'+k for k in cols[1:])+';')
lines.append('UPDATE stock_map_source SET status='+sql(layout['status'])+',source_name='+sql(layout['source_name'])+',source_sha256='+sql(layout['source_sha256'])+',width=2080,height=2580,notes='+sql(layout['derivation'])+',version=version+1 WHERE singleton;')
Path('db/migrations/030_stock_map_site_geometry.sql').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Geometry only: 165 slots, 12 site features, source hash '+layout['source_sha256'])
