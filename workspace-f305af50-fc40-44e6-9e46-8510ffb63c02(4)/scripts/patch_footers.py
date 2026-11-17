#!/usr/bin/env python3
"""Patch footers: Roman for TOC section (marked with ZWSP), arabic for body.
Also remove empty <w:pgNumType/> from document.xml."""
import sys, zipfile, shutil, re, os

path = sys.argv[1]
tmp = path + ".tmp"
shutil.copy(path, tmp)

zin = zipfile.ZipFile(tmp, "r")
names = zin.namelist()
out = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)

pat = re.compile(r"(<w:instrText[^>]*>)([^<]*PAGE[^<]*)(</w:instrText>)")

for name in names:
    data = zin.read(name)
    if name == "word/document.xml":
        xml = data.decode("utf-8")
        xml = xml.replace("<w:pgNumType/>", "")
        # 目次エントリの行間を圧縮し、目次+ヒントを1ページに収める
        xml = xml.replace('<w:spacing w:before="120" w:after="60"/>', "")
        # TOC重複除去: フィールド段落内に注入された先頭エントリ(hyperlink)を除去する
        # (通常段落側のプレースホルダーエントリのみを表示させる)
        m = re.search(r"<w:p>(?:(?!</w:p>).)*?TOC \\h(?:(?!</w:p>).)*?</w:p>", xml, re.S)
        if m:
            seg = m.group(0)
            seg2 = re.sub(r"<w:hyperlink\b.*?</w:hyperlink>", "", seg, flags=re.S)
            xml = xml[:m.start()] + seg2 + xml[m.end():]
        data = xml.encode("utf-8")
    elif re.match(r"word/footer\d+\.xml", name):
        xml = data.decode("utf-8")
        fmt = "ROMAN" if "\u200b" in xml or "\u200B" in xml else "arabic"
        xml = pat.sub(lambda m: m.group(1) + " PAGE \\* " + fmt + " \\* MERGEFORMAT " + m.group(3), xml)
        data = xml.encode("utf-8")
    out.writestr(name, data)

zin.close()
out.close()
os.remove(tmp)
print("footer patch done")
