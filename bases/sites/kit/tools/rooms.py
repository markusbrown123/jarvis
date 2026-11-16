#!/usr/bin/env python3
"""Illustrated stand-in rooms for the walkthrough page's sample cut.

The walkthrough service has no listing photos it may show yet, so the page's
sample is made from these: flat drawings of a house, one per room, in one
graphic language. They go through the real pipeline (bases/realestate
walkthrough.py) and the page says they're illustrations.

    python3 tools/rooms.py out/rooms      # writes 01-exterior-front.svg …
"""
import pathlib
import sys

W, H = 2048, 1365

# One palette for every room: plaster, oak, slate, linen, sage, lime.
P = {
    'sky': '#cfe0ea', 'wall': '#ece6dc', 'wall2': '#e2dbcf', 'wall3': '#d8d0c3', 'ceil': '#f4f0e9',
    'oak': '#b98b5e', 'oak2': '#a67a4f', 'slate': '#3b4350', 'slate2': '#2b313b', 'linen': '#f7f3ec',
    'sage': '#8fa78a', 'sage2': '#6f8a6b', 'lime': '#c8ff00', 'glass': '#b9d3df', 'glass2': '#a5c4d2',
    'rug': '#c9b9a3', 'brass': '#c9a35a', 'white': '#fbfaf7', 'shadow': 'rgba(40,30,20,0.12)',
}


def room(back, floor_col, extra, wall_l=None, wall_r=None):
    """A one-point-perspective room: back wall, side walls, floor, ceiling."""
    bx0, by0, bx1, by1 = 560, 300, 1488, 930
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{P['ceil']}"/>
<polygon points="0,0 {bx0},{by0} {bx0},{by1} 0,{H}" fill="{wall_l or P['wall2']}"/>
<polygon points="{W},0 {bx1},{by0} {bx1},{by1} {W},{H}" fill="{wall_r or P['wall3']}"/>
<polygon points="0,0 {W},0 {bx1},{by0} {bx0},{by0}" fill="{P['ceil']}"/>
<rect x="{bx0}" y="{by0}" width="{bx1 - bx0}" height="{by1 - by0}" fill="{back}"/>
<polygon points="0,{H} {bx0},{by1} {bx1},{by1} {W},{H}" fill="{floor_col}"/>
{''.join(f'<line x1="{bx0 + i * (bx1 - bx0) / 8:.0f}" y1="{by1}" x2="{-400 + i * (W + 800) / 8:.0f}" y2="{H}" stroke="rgba(0,0,0,0.07)" stroke-width="3"/>' for i in range(1, 8))}
{extra}
</svg>'''


def window(x, y, w, h, view=''):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{P["glass"]}"/>{view}'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="{P["white"]}" stroke-width="14"/>'
            f'<line x1="{x + w / 2}" y1="{y}" x2="{x + w / 2}" y2="{y + h}" stroke="{P["white"]}" stroke-width="10"/>')


def trees(x, y, w):
    return (f'<rect x="{x}" y="{y + 60}" width="{w}" height="80" fill="{P["sage"]}"/>'
            f'<circle cx="{x + w * .25}" cy="{y + 60}" r="{w * .16}" fill="{P["sage2"]}"/>'
            f'<circle cx="{x + w * .7}" cy="{y + 50}" r="{w * .2}" fill="{P["sage"]}"/>')


def plant(x, y, s=1):
    return (f'<rect x="{x - 40 * s}" y="{y - 90 * s}" width="{80 * s}" height="{90 * s}" rx="{10 * s}" fill="{P["slate"]}"/>'
            f'<ellipse cx="{x - 50 * s}" cy="{y - 170 * s}" rx="{45 * s}" ry="{90 * s}" fill="{P["sage2"]}" transform="rotate(-25 {x - 50 * s} {y - 170 * s})"/>'
            f'<ellipse cx="{x + 45 * s}" cy="{y - 180 * s}" rx="{45 * s}" ry="{95 * s}" fill="{P["sage"]}" transform="rotate(22 {x + 45 * s} {y - 180 * s})"/>'
            f'<ellipse cx="{x}" cy="{y - 230 * s}" rx="{40 * s}" ry="{100 * s}" fill="{P["sage2"]}"/>')


def living():
    view = trees(760, 430, 520)
    return room(P['wall'], P['oak'], f'''
{window(760, 400, 520, 330, view)}
<rect x="640" y="440" width="70" height="90" fill="{P['slate']}"/><rect x="652" y="452" width="46" height="66" fill="{P['lime']}"/>
<ellipse cx="1024" cy="1150" rx="620" ry="120" fill="{P['rug']}"/>
<rect x="560" y="800" width="900" height="240" rx="36" fill="{P['slate']}"/>
<rect x="600" y="740" width="820" height="130" rx="40" fill="{P['slate2']}"/>
<rect x="540" y="820" width="90" height="220" rx="30" fill="{P['slate2']}"/><rect x="1390" y="820" width="90" height="220" rx="30" fill="{P['slate2']}"/>
<rect x="700" y="780" width="160" height="110" rx="26" fill="{P['linen']}"/><rect x="1160" y="780" width="160" height="110" rx="26" fill="{P['sage']}"/>
<ellipse cx="1024" cy="1180" rx="260" ry="46" fill="{P['oak2']}"/><rect x="800" y="1130" width="448" height="40" rx="20" fill="{P['oak']}"/>
<rect x="1640" y="560" width="10" height="560" fill="{P['slate2']}"/><path d="M1580 560 h130 l-30 -110 h-70 z" fill="{P['linen']}"/>
{plant(330, 1180, 1.6)}''')


def kitchen():
    cab = ''.join(f'<rect x="{600 + i * 112}" y="330" width="100" height="170" fill="{P["white"]}"/>' for i in range(8))
    stools = ''.join(f'<rect x="{730 + i * 220}" y="1060" width="20" height="200" fill="{P["slate2"]}"/><rect x="{690 + i * 220}" y="1040" width="100" height="34" rx="17" fill="{P["oak2"]}"/>' for i in range(3))
    pend = ''.join(f'<line x1="{800 + i * 220}" y1="0" x2="{800 + i * 220}" y2="560" stroke="{P["slate2"]}" stroke-width="5"/><path d="M{760 + i * 220} 560 h80 l-15 -60 h-50 z" fill="{P["brass"]}"/>' for i in range(3))
    return room(P['wall'], '#cdbfae', f'''
{cab}
<rect x="560" y="640" width="928" height="290" fill="{P['sage2']}"/><rect x="560" y="620" width="928" height="26" fill="{P['white']}"/>
{window(880, 520, 290, 100)}
<rect x="1220" y="560" width="70" height="60" fill="{P['slate']}"/>
<rect x="520" y="860" width="1010" height="70" fill="{P['white']}"/>
<rect x="560" y="930" width="930" height="210" fill="{P['sage']}"/>
{stools}{pend}''')


def bedroom():
    return room('#e5ddd2', P['oak'], f'''
{window(1180, 400, 250, 330, trees(1180, 470, 250))}
<rect x="650" y="560" width="520" height="230" rx="20" fill="{P['slate']}"/>
<rect x="600" y="760" width="620" height="290" rx="24" fill="{P['linen']}"/>
<rect x="600" y="900" width="620" height="150" rx="20" fill="{P['sage']}"/>
<rect x="680" y="710" width="190" height="90" rx="30" fill="{P['white']}"/><rect x="950" y="710" width="190" height="90" rx="30" fill="{P['white']}"/>
<rect x="430" y="820" width="140" height="150" fill="{P['oak2']}"/><rect x="1250" y="820" width="140" height="150" fill="{P['oak2']}"/>
<path d="M455 820 h90 l-18 -80 h-54 z" fill="{P['lime']}"/><path d="M1275 820 h90 l-18 -80 h-54 z" fill="{P['linen']}"/>
<ellipse cx="910" cy="1220" rx="520" ry="90" fill="{P['rug']}"/>''')


def exterior():
    win = ''.join(window(x, y, 170, 170) for x, y in [(640, 520), (900, 520), (1160, 520), (640, 830), (1160, 830)])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{P['sky']}"/>
<circle cx="1700" cy="260" r="90" fill="{P['white']}"/>
<rect x="0" y="1060" width="{W}" height="305" fill="{P['sage']}"/>
<circle cx="200" cy="900" r="230" fill="{P['sage2']}"/><rect x="185" y="900" width="30" height="200" fill="{P['oak2']}"/>
<circle cx="1830" cy="930" r="190" fill="{P['sage2']}"/><rect x="1815" y="930" width="30" height="170" fill="{P['oak2']}"/>
<rect x="540" y="430" width="960" height="660" fill="{P['wall']}"/>
<polygon points="500,440 1024,190 1548,440" fill="{P['slate']}"/>
<rect x="540" y="740" width="960" height="24" fill="{P['wall3']}"/>
{win}
<rect x="900" y="820" width="170" height="270" fill="{P['oak2']}"/><circle cx="1045" cy="960" r="10" fill="{P['brass']}"/>
<polygon points="900,1090 1070,1090 1180,1365 790,1365" fill="#d9cfc0"/>
<rect x="560" y="1050" width="300" height="50" rx="25" fill="{P['sage2']}"/><rect x="1110" y="1050" width="370" height="50" rx="25" fill="{P['sage2']}"/>
</svg>'''


def garden():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{P['sky']}"/>
<rect x="0" y="640" width="{W}" height="725" fill="{P['sage']}"/>
{''.join(f'<rect x="{i * 128}" y="520" width="112" height="200" fill="{P["oak"]}"/>' for i in range(17))}
<circle cx="380" cy="500" r="220" fill="{P['sage2']}"/><circle cx="1650" cy="470" r="260" fill="{P['sage2']}"/><circle cx="1050" cy="520" r="160" fill="{P['sage']}"/>
<polygon points="560,1365 860,860 1190,860 1490,1365" fill="#d9cfc0"/>
<rect x="760" y="900" width="530" height="120" rx="14" fill="{P['oak2']}"/>
<rect x="700" y="1000" width="110" height="140" rx="12" fill="{P['slate']}"/><rect x="1240" y="1000" width="110" height="140" rx="12" fill="{P['slate']}"/>
<rect x="985" y="700" width="16" height="220" fill="{P['slate2']}"/><path d="M880 720 q113 -120 226 0 z" fill="{P['linen']}"/>
{plant(240, 1300, 2)}{plant(1840, 1300, 1.8)}
</svg>'''


ROOMS = [('01-exterior-front', exterior), ('02-living-room', living), ('03-kitchen', kitchen), ('04-bedroom-main', bedroom), ('05-garden', garden)]

if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'out/rooms')
    out.mkdir(parents=True, exist_ok=True)
    for name, fn in ROOMS:
        (out / f'{name}.svg').write_text(fn())
    print(f'{len(ROOMS)} rooms in {out}')
