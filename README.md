# Match Point

Tenis pro jednoho hráče proti počítači. Plynulá Canvas hra v češtině, která běží na počítači i telefonu bez účtu, reklam nebo externích knihoven.

## Hrát

Webová adresa po aktivaci GitHub Pages a úspěšném nasazení: **https://nachy7.github.io/Tenis/**.

**Bez čekání na hostování:** [stáhněte ZIP hry](https://github.com/nAchy7/Tenis/archive/refs/heads/main.zip), rozbalte jej a otevřete přiložený `play.html` v prohlížeči. Nepotřebujete instalaci ani server. Soubor obsahuje celou hru a můžete ho sdílet samostatně.

Při vývoji `npm run build` sestaví aktuální verzi do `_site/play.html`; `npm run export` aktualizuje navíc přiložený `play.html` v kořeni repozitáře.

## Ovládání

| Akce | Klávesnice | Myš / telefon |
| --- | --- | --- |
| Pohyb | Šipky nebo WASD | Přidržet místo na vlastní polovině kurtu |
| Podání | Mezerník | Kliknout na kurt / ÚDER |
| Silnější úder | Podržet mezerník a pustit u míčku | Podržet a pustit ÚDER |
| Směr úderu | Q doleva, E doprava | Směr místa, kam vedete hráče |
| Vysoký lob | L | LOB |
| Pauza / pokračovat | Esc nebo P | Tlačítko Pauza |
| Celá obrazovka / zpět | F; Esc pro návrat | Tlačítko Celá obrazovka / Zmenšit |

Asistence automaticky načasuje základní úder, když hráč stojí blízko míčku. Lze ji vypnout na bočním panelu. Pohyb a správná pozice zůstávají na vás. Bez určeného směru hráč míří do volného prostoru. Tři obtížnosti mění rychlost, reakce a přesnost soupeře; soupeř běhá podle stejné fyziky, bez teleportování. Opuštění okna automaticky pozastaví zápas.

Krátký set do 4 her s rozdílem dvou; za stavu 3 : 3 se hraje tie-break do 7 bodů s rozdílem dvou. Běžné hry používají 0, 15, 30, 40, shodu a výhodu. Pro svižnou hru jsou základní údery a podání vedené do kurtu; nejde o úplnou simulaci profesionálního tenisu (nejsou druhá podání ani chyby nohou).

## Vývoj

Vyžaduje Node.js 20+, doporučeno 24. Žádné závislosti se neinstalují.

```sh
npm start        # lokální server na portu 3000; lze změnit pomocí PORT
npm test         # fyzika, skóre, podání a chování soupeře
npm run check   # kontrola syntaxe
npm run build   # statické soubory + samostatná offline verze v _site/
```

Pro automatické ověření prohlížeče: Python s balíčkem Playwright a Chromium, pak `python tests/browser_smoke.py`. Skript spouští vlastní server a kontroluje desktop i mobil.

`game.js` obsahuje simulaci v pevných krocích 120 Hz, `app.js` vykreslování a ovládání. Web nevyžaduje backend, databázi, klíče ani placené služby. Fonty, kresba a zvuky jsou lokální; hra za běhu nevolá externí servery.

## Zveřejnění na GitHub Pages

1. V repozitáři otevřete **Settings → Pages → Build and deployment → Source: GitHub Actions**. Tím se aktivuje hostování.
2. Push do větve `main` automaticky spustí workflow **Test and publish tennis**, nebo ho spusťte ručně v Actions.
3. Workflow nejprve spustí testy, kontrolu syntaxe a sestavení, poté nasadí pouze veřejné herní soubory. Po úspěšném nasazení je hra dostupná na adrese uvedené výše.

Aktivace Pages vyžaduje oprávnění správce repozitáře. Samotný push či přítomnost workflow nejsou důkazem, že web už byl nasazen.
