#!/usr/bin/env python3
"""Cartes synthétiques avec vérité terrain. Aucune carte client."""
import json
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

OUT = Path(os.environ.get("OCR_BENCH_DIR", "/tmp/ciblix-ocr-bench"))
LATIN = "/System/Library/Fonts/Supplemental/Arial.ttf"
LATIN_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ARABIC = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except ImportError:
    arabic_reshaper = None
    get_display = None


def shape(text, arabic):
    if not arabic or arabic_reshaper is None:
        return text
    return get_display(arabic_reshaper.reshape(text))


def font(path, size):
    return ImageFont.truetype(path, size)


CARDS = [
    {"id": "fr-01", "lang": "fr", "usable": True, "lines": [("Atelier Lumen", 54, False), ("Claire Morel", 40, False), ("Directrice", 28, False), ("01 42 00 10 20", 32, False), ("claire.morel@atelier-lumen.fr", 28, False), ("12 rue des Arts, Paris", 26, False)], "expect": {"company": "Atelier Lumen", "contact": "Claire Morel", "job": "Directrice", "phone": "", "phone_work": "+33142001020", "email": "claire.morel@atelier-lumen.fr", "company_phone": "+33142001020", "city": "Paris"}},
    {"id": "fr-02", "lang": "fr", "usable": True, "lines": [("Nord & Fils", 52, False), ("Hugo Bernard", 38, False), ("Mobile 06 18 20 30 40", 30, False), ("Standard 01 53 00 20 10", 30, False), ("hugo.bernard@nord-fils.fr", 26, False), ("Lille, France", 26, False)], "expect": {"company": "Nord & Fils", "contact": "Hugo Bernard", "phone": "+33618203040", "phone_work": "+33153002010", "email": "hugo.bernard@nord-fils.fr", "city": "Lille", "country": "France"}},
    {"id": "fr-03", "lang": "fr", "usable": True, "lines": [("Maison Calanque", 50, False), ("Léa Martin", 36, False), ("Responsable export", 28, False), ("lea.martin@calanque.fr", 28, False), ("www.calanque.fr", 28, False), ("Marseille", 28, False)], "expect": {"company": "Maison Calanque", "contact": "Léa Martin", "job": "Responsable export", "email": "lea.martin@calanque.fr", "website": "www.calanque.fr", "city": "Marseille", "phone": ""}},
    {"id": "fr-04", "lang": "fr", "usable": True, "lines": [("Studio Brume", 50, False), ("Paul Renard", 36, False), ("paul.renard@studio-brume.fr", 26, False), ("contact@studio-brume.fr", 26, False), ("04 91 00 22 18", 30, False)], "expect": {"company": "Studio Brume", "contact": "Paul Renard", "email": "paul.renard@studio-brume.fr", "company_email": "contact@studio-brume.fr", "phone_work": "+33491002218"}},
    {"id": "fr-05", "lang": "fr", "usable": True, "lines": [("Imprimerie Dorée", 48, False), ("Chloé Faure", 36, False), ("Graphiste", 28, False), ("Lyon", 28, False)], "expect": {"company": "Imprimerie Dorée", "contact": "Chloé Faure", "job": "Graphiste", "city": "Lyon", "phone": "", "email": ""}},
    {"id": "fr-06", "lang": "fr", "usable": True, "tilt": 8, "lines": [("Verger Blanc", 50, False), ("Marc Ellul", 36, False), ("06 22 18 40 55", 32, False), ("marc.ellul@verger-blanc.fr", 26, False), ("Nantes", 28, False)], "expect": {"company": "Verger Blanc", "contact": "Marc Ellul", "phone": "+33622184055", "email": "marc.ellul@verger-blanc.fr", "city": "Nantes"}},
    {"id": "fr-07", "lang": "fr", "usable": False, "dim": 0.45, "lines": [("Atelier Nuit", 48, False), ("Inès Collet", 34, False), ("ines.collet@atelier-nuit.fr", 24, False), ("02 40 00 18 90", 28, False)], "expect": {"company": "Atelier Nuit", "contact": "Inès Collet", "email": "ines.collet@atelier-nuit.fr", "phone_work": "+33240001890"}},
    {"id": "fr-08", "lang": "fr", "usable": True, "complex": True, "lines": [("Compagnie des Docks", 42, False), ("Sarah Benyamina", 34, False), ("Directrice commerciale", 24, False), ("Mobile 07 81 20 30 40", 24, False), ("Bureau 01 48 00 77 20", 24, False), ("sarah.benyamina@docks.fr", 22, False), ("8 quai de Seine, Paris", 22, False), ("www.docks.fr", 22, False)], "expect": {"company": "Compagnie des Docks", "contact": "Sarah Benyamina", "job": "Directrice commerciale", "phone": "+33781203040", "phone_work": "+33148007720", "email": "sarah.benyamina@docks.fr", "website": "www.docks.fr", "city": "Paris"}},
    {"id": "en-01", "lang": "en", "usable": True, "lines": [("Harbor & Co", 52, False), ("James Carter", 38, False), ("Sales director", 28, False), ("+44 20 7946 0018", 30, False), ("james.carter@harbor-co.uk", 26, False), ("London", 28, False)], "expect": {"company": "Harbor & Co", "contact": "James Carter", "job": "Sales director", "phone_work": "+442079460018", "email": "james.carter@harbor-co.uk", "city": "London"}},
    {"id": "en-02", "lang": "en", "usable": True, "lines": [("Northwind Labs", 50, False), ("Maya Chen", 36, False), ("+1 415 555 0134", 32, False), ("maya.chen@northwindlabs.com", 26, False), ("San Francisco", 28, False)], "expect": {"company": "Northwind Labs", "contact": "Maya Chen", "phone": "+14155550134", "email": "maya.chen@northwindlabs.com", "city": "San Francisco"}},
    {"id": "en-03", "lang": "en", "usable": True, "lines": [("Bright Parcel", 50, False), ("Owen Blake", 36, False), ("Mobile +1 646 555 0199", 28, False), ("Office +1 212 555 0148", 28, False), ("owen.blake@brightparcel.com", 24, False)], "expect": {"company": "Bright Parcel", "contact": "Owen Blake", "phone": "+16465550199", "phone_work": "+12125550148", "email": "owen.blake@brightparcel.com"}},
    {"id": "en-04", "lang": "en", "usable": True, "qr": True, "lines": [("Cedar Audit", 48, False), ("Helen Price", 34, False), ("helen.price@cedaraudit.com", 26, False), ("+44 161 496 0123", 28, False)], "expect": {"company": "Cedar Audit", "contact": "Helen Price", "email": "helen.price@cedaraudit.com", "phone_work": "+441614960123"}},
    {"id": "en-05", "lang": "en", "usable": True, "tilt": 12, "lines": [("Fieldnote", 52, False), ("Adam Brooks", 36, False), ("adam.brooks@fieldnote.io", 26, False), ("+1 503 555 0177", 30, False)], "expect": {"company": "Fieldnote", "contact": "Adam Brooks", "email": "adam.brooks@fieldnote.io", "phone": "+15035550177"}},
    {"id": "en-06", "lang": "en", "usable": False, "dim": 0.4, "lines": [("Low Light Co", 48, False), ("Rita Cole", 34, False), ("rita.cole@lowlight.co", 24, False), ("+44 113 496 0000", 26, False)], "expect": {"company": "Low Light Co", "contact": "Rita Cole", "email": "rita.cole@lowlight.co", "phone_work": "+441134960000"}},
    {"id": "en-07", "lang": "en", "usable": True, "lines": [("Paper North", 50, False), ("Sam Irving", 36, False), ("Editor", 28, False), ("Edinburgh", 28, False)], "expect": {"company": "Paper North", "contact": "Sam Irving", "job": "Editor", "city": "Edinburgh", "phone": "", "email": ""}},
    {"id": "en-08", "lang": "en", "usable": True, "complex": True, "lines": [("Atlas Freight", 44, False), ("Nora Blake", 32, False), ("Operations", 24, False), ("+44 20 7946 0991", 24, False), ("+44 7700 900123", 24, False), ("nora.blake@atlasfreight.co.uk", 22, False), ("14 Dock Road, London", 22, False)], "expect": {"company": "Atlas Freight", "contact": "Nora Blake", "job": "Operations", "phone": "+447700900123", "phone_work": "+442079460991", "email": "nora.blake@atlasfreight.co.uk", "city": "London"}},
    {"id": "ar-01", "lang": "ar", "usable": True, "lines": [("دار النور", 54, True), ("ليلى بن يوسف", 40, True), ("مديرة", 30, True), ("+216 71 430 210", 30, False), ("laila.benyoussef@dar-ennour.tn", 24, False), ("تونس", 30, True)], "expect": {"company": "دار النور", "contact": "ليلى بن يوسف", "job": "مديرة", "phone_work": "+21671430210", "email": "laila.benyoussef@dar-ennour.tn", "country": "تونس"}},
    {"id": "ar-02", "lang": "ar", "usable": True, "lines": [("مؤسسة الساحل", 50, True), ("كريم حمدي", 38, True), ("Mobile 20 555 018", 32, False), ("karim.hamdi@sahel.tn", 26, False), ("صفاقس", 30, True), ("تونس", 28, True)], "expect": {"company": "مؤسسة الساحل", "contact": "كريم حمدي", "phone": "+21620555018", "email": "karim.hamdi@sahel.tn", "city": "صفاقس", "country": "تونس"}},
    {"id": "ar-03", "lang": "ar", "usable": True, "tilt": 6, "lines": [("ورشة الخط", 50, True), ("سلمى طرابلسي", 36, True), ("salma.trabelsi@khat.tn", 26, False), ("98 220 145", 32, False), ("تونس", 28, True)], "expect": {"company": "ورشة الخط", "contact": "سلمى طرابلسي", "email": "salma.trabelsi@khat.tn", "phone": "+21698220145", "country": "تونس"}},
    {"id": "ar-04", "lang": "ar", "usable": True, "lines": [("مكتب الأفق", 50, True), ("ياسين شريف", 36, True), ("yassine.cherif@ofoq.tn", 24, False), ("Standard 73 200 880", 30, False), ("تونس", 28, True)], "expect": {"company": "مكتب الأفق", "contact": "ياسين شريف", "email": "yassine.cherif@ofoq.tn", "phone_work": "+21673200880", "country": "تونس"}},
    {"id": "tn-01", "lang": "tn", "usable": True, "lines": [("Atelier Sud", 52, False), ("Amina Jaziri", 38, False), ("Mobile 20 111 334", 30, False), ("Standard 74 000 210", 30, False), ("amina.jaziri@atelier-sud.tn", 24, False), ("Sfax", 28, False), ("Tunisie", 28, False)], "expect": {"company": "Atelier Sud", "contact": "Amina Jaziri", "phone": "+21620111334", "phone_work": "+21674000210", "email": "amina.jaziri@atelier-sud.tn", "city": "Sfax", "country": "Tunisie"}},
    {"id": "tn-02", "lang": "tn", "usable": True, "lines": [("Oliviers de Nabeul", 46, False), ("Sami Khelifi", 36, False), ("Standard 72 286 440", 32, False), ("sami.khelifi@oliviers.tn", 26, False), ("Nabeul", 28, False), ("Tunisie", 28, False)], "expect": {"company": "Oliviers de Nabeul", "contact": "Sami Khelifi", "phone_work": "+21672286440", "email": "sami.khelifi@oliviers.tn", "city": "Nabeul", "country": "Tunisie"}},
    {"id": "tn-03", "lang": "tn", "usable": True, "lines": [("Carthage Studio", 48, False), ("Nour Belhadj", 36, False), ("+216.98.441.220", 32, False), ("nour.belhadj@carthage-studio.tn", 22, False), ("Tunis", 28, False)], "expect": {"company": "Carthage Studio", "contact": "Nour Belhadj", "phone": "+21698441220", "email": "nour.belhadj@carthage-studio.tn", "city": "Tunis"}},
    {"id": "tn-04", "lang": "tn", "usable": True, "lines": [("Médina Bois", 50, False), ("Hatem Saidi", 36, False), ("Siège 71 960 330", 28, False), ("Atelier 73 441 118", 28, False), ("hatem.saidi@medina-bois.tn", 24, False), ("12 rue du Pacha, Tunis", 24, False), ("Zone industrielle, Sousse", 24, False)], "expect": {"company": "Médina Bois", "contact": "Hatem Saidi", "phone_work": "+21671960330", "email": "hatem.saidi@medina-bois.tn", "city": "Tunis", "address": "12 rue du Pacha"}},
    {"id": "tn-05", "lang": "tn", "usable": True, "tilt": 10, "lines": [("Sel de Kerkennah", 46, False), ("Rym Maatoug", 36, False), ("Mobile 52 880 214", 32, False), ("rym.maatoug@sel-kerkennah.tn", 22, False), ("Tunisie", 28, False)], "expect": {"company": "Sel de Kerkennah", "contact": "Rym Maatoug", "phone": "+21652880214", "email": "rym.maatoug@sel-kerkennah.tn", "country": "Tunisie"}},
    {"id": "tn-06", "lang": "tn", "usable": False, "dim": 0.42, "lines": [("Phare de Bizerte", 46, False), ("Anis Gharbi", 34, False), ("anis.gharbi@phare-bizerte.tn", 22, False), ("72 431 009", 28, False), ("Tunisie", 26, False)], "expect": {"company": "Phare de Bizerte", "contact": "Anis Gharbi", "email": "anis.gharbi@phare-bizerte.tn", "phone_work": "+21672431009", "country": "Tunisie"}},
    {"id": "mx-01", "lang": "fr", "usable": True, "qr": True, "lines": [("QR Conseil", 48, False), ("Julie Aubert", 34, False), ("julie.aubert@qr-conseil.fr", 24, False), ("06 70 12 44 80", 30, False)], "expect": {"company": "QR Conseil", "contact": "Julie Aubert", "email": "julie.aubert@qr-conseil.fr", "phone": "+33670124480"}},
    {"id": "mx-02", "lang": "fr", "usable": False, "tiny": True, "lines": [("Micro Texte", 22, False), ("Luc Petit", 18, False), ("luc.petit@micro-texte.fr", 16, False), ("Standard 01 84 00 22 90", 16, False)], "expect": {"company": "Micro Texte", "contact": "Luc Petit", "email": "luc.petit@micro-texte.fr", "phone_work": "+33184002290"}},
    {"id": "mx-03", "lang": "ar", "usable": True, "lines": [("Ciblix Maghreb", 46, False), ("هند بوسلامة", 36, True), ("Chargée de clientèle", 26, False), ("hind.bouslama@ciblix-maghreb.tn", 22, False), ("+216 71 000 640", 28, False), ("تونس", 28, True)], "expect": {"company": "Ciblix Maghreb", "contact": "هند بوسلامة", "job": "Chargée de clientèle", "email": "hind.bouslama@ciblix-maghreb.tn", "phone_work": "+21671000640", "country": "تونس"}},
    {"id": "mx-04", "lang": "tn", "usable": True, "lines": [("Trois Lignes", 48, False), ("Mehdi Kacem", 36, False), ("Mobile 98 100 200", 28, False), ("Bureau 71 200 300", 28, False), ("WhatsApp 58 300 400", 28, False), ("mehdi.kacem@trois-lignes.tn", 22, False), ("Tunisie", 26, False)], "expect": {"company": "Trois Lignes", "contact": "Mehdi Kacem", "phone": "+21698100200", "phone_work": "+21671200300", "whatsapp": "+21658300400", "email": "mehdi.kacem@trois-lignes.tn", "country": "Tunisie"}},
]


def render(card):
    image = Image.new("RGB", (1200, 760), (244, 247, 246))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((70, 70, 1130, 690), radius=28, fill=(255, 255, 255), outline=(23, 61, 65), width=3)
    y = 110
    for text, size, arabic in card["lines"]:
        face = font(ARABIC if arabic else (LATIN_BOLD if size >= 46 else LATIN), size)
        shown = shape(text, arabic)
        if arabic:
            box = draw.textbbox((0, 0), shown, font=face)
            width = box[2] - box[0]
            draw.text((1100 - width, y), shown, fill=(23, 61, 65), font=face)
        else:
            draw.text((110, y), shown, fill=(23, 61, 65), font=face)
        y += size + 18
    if card.get("qr"):
        x0, y0 = 900, 430
        cell = 10
        for row in range(12):
            for col in range(12):
                if (row + col) % 3 == 0 or row in (0, 11) or col in (0, 11):
                    draw.rectangle((x0 + col * cell, y0 + row * cell, x0 + (col + 1) * cell, y0 + (row + 1) * cell), fill=(20, 20, 20))
    if card.get("tilt"):
        image = image.rotate(card["tilt"], expand=True, fillcolor=(180, 186, 184), resample=Image.Resampling.BICUBIC)
    if card.get("dim"):
        image = ImageEnhance.Brightness(image).enhance(card["dim"])
    path = OUT / f"{card['id']}.jpg"
    image.save(path, "JPEG", quality=90)
    return path.name


def main():
    if arabic_reshaper is None:
        raise SystemExit("Installez arabic-reshaper et python-bidi pour les cartes arabes.")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for card in CARDS:
        file_name = render(card)
        manifest.append({
            "id": card["id"],
            "lang": card["lang"],
            "usable": card["usable"],
            "file": file_name,
            "expect": card["expect"]
        })
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(manifest)} cartes dans {OUT}")


if __name__ == "__main__":
    main()
