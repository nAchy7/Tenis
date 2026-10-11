# Match Point 3D

Plně hratelný 3D tenis pro jednoho hráče proti počítači. Prostorový antukový kurt s PBR materiálem, denní osvětlení, animovaní hráči a rakety, letící míček, stíny a stadion. Hra v češtině běží na počítači i telefonu bez účtu nebo reklam. 3D knihovna, povrchové mapy i HDR osvětlení jsou součástí hry; při hraní se nic nestahuje z externích CDN.

## Hrát

Webová adresa po aktivaci GitHub Pages a úspěšném nasazení: **https://nachy7.github.io/Tenis/**.

**Bez čekání na hostování:** [stáhněte ZIP hry](https://github.com/nAchy7/Tenis/archive/refs/heads/main.zip), rozbalte jej a otevřete přiložený `play.html` v prohlížeči. Nepotřebujete instalaci ani server. Soubor obsahuje celou hru a můžete ho sdílet samostatně.

Při vývoji `npm run build` sestaví aktuální verzi do `_site/play.html`; `npm run export` aktualizuje navíc přiložený `play.html` v kořeni repozitáře.

## Ovládání

| Akce | Klávesnice | Myš / telefon |
| --- | --- | --- |
| Pohyb | Šipky nebo WASD | Levý ovladač POHYB v blízkém pohledu / přidržet místo na kurtu |
| Podání | Mezerník | Kliknout na kurt / ÚDER |
| Silnější úder | Podržet mezerník a pustit u míčku | Podržet a pustit ÚDER |
| Směr úderu | Q doleva, E doprava | Směr místa, kam vedete hráče |
| Vysoký lob | L | LOB |
| Kamera: za hlavou / první osoba / celý kurt | C | Tlačítko kamery pod kurtem |
| Pauza / pokračovat | Esc nebo P | Tlačítko Pauza |
| Celá obrazovka / zpět | F; Esc pro návrat | Tlačítko Celá obrazovka / Zmenšit |

Hra začíná pohledem těsně za hlavou hráče. Kamera sleduje jeho pohyb po kurtu. Klávesa C nebo tlačítko kamery přepne do první osoby a potom na přehled celého kurtu. V první osobě vlastní postava nezakrývá výhled. Šipka upozorní na příchozí míček mimo záběr.

Asistence automaticky načasuje základní úder, když hráč stojí blízko míčku. Lze ji vypnout na bočním panelu. Pro silný úder podržte mezerník a pusťte jej u míčku; během nabíjení hráč čeká na vaše puštění. Pohyb a správná pozice zůstávají na vás. Bez určeného směru hráč míří do volného prostoru. Tři obtížnosti mění rychlost, reakce a přesnost soupeře; soupeř běhá podle stejné fyziky, bez teleportování. Asistence ukazuje i předpokládané místo dopadu míčku. Opuštění okna automaticky pozastaví zápas.

Krátký set do 4 her s rozdílem dvou; za stavu 3 : 3 se hraje tie-break do 7 bodů s rozdílem dvou. Běžné hry používají 0, 15, 30, 40, shodu a výhodu. Pro svižnou hru jsou základní údery a podání vedené do kurtu; nejde o úplnou simulaci profesionálního tenisu (nejsou druhá podání ani chyby nohou).

## Vývoj

Vyžaduje Node.js 20+, doporučeno 24. Prohlížeč potřebuje WebGL 2 a zapnutou grafickou akceleraci. Závislosti jsou přesně uzamčené v `package-lock.json`.

```sh
npm ci           # Three.js a esbuild podle lockfilu
npm run build    # sestavení před lokálním spuštěním
npm start        # lokální server na portu 3000; lze změnit pomocí PORT
npm test         # fyzika, skóre, podání a chování soupeře
npm run check   # kontrola syntaxe
npm run export  # aktualizace přiloženého bundle.js a samostatného play.html
```

Pro automatické ověření prohlížeče: Python s balíčkem Playwright a Chromium, pak `python tests/browser_smoke.py`. Skript spouští vlastní server a kontroluje desktop i mobil.

`game.js` obsahuje simulaci v pevných krocích 120 Hz, `renderer3d.js` scénu a perspektivní kamery v Three.js, `clay3d.js` antukový materiál, `daylight3d.js` osvětlení a `app.js` ovládání a rozhraní. Dotykové i myší souřadnice se určují průsečíkem paprsku kamery s kurtem. `build.js` sestaví veškerý JavaScript i importované obrázky a HDR do `bundle.js`; `npm run export` aktualizuje i tento přiložený bundle a samostatný `play.html`, aby fungovalo hostování přímo z větve `main` a hraní offline. Po úpravách kódu před publikací spusťte `npm run export`.

Web nevyžaduje backend, databázi, klíče ani placené služby. Fonty, modely, textura kurtu a zvuky jsou lokální; hra za běhu nevolá externí servery. Zdrojové CC0 mapy, HDR a GLB strom jsou uložené v `assets/`; jejich původ a licence jsou v [assets/LICENSES.md](assets/LICENSES.md). Sestavení je vloží do hry jako data URL, takže samostatný `play.html` funguje i bez připojení. Oznámení licence Three.js je uvnitř bundlu; `THIRD_PARTY_NOTICES.txt` obsahuje také licence grafických assetů a sestavení je kopíruje do `_site/`. Testy prohlížeče ověřují skutečné WebGL vykreslování, všechny tři kamery, fullscreen, výměny, skóre i mobilní ovládání; software WebGL v testech není měřením výkonu skutečného telefonu.

Antuka kombinuje fotografické albedo, normály a roughness s jemnými barevnými odchylkami a stopami bot a dopadů. Denní HDR se zpracuje přes PMREM; slunce vrhá stíny v rozlišení 2048 px, na telefonu 1024 px. `vegetation3d.js` vykresluje 30 modelů stromu pomocí tří instancovaných meshů. Herní kamery, rozměry kurtu a simulace zůstávají stejné.

## Zveřejnění na GitHub Pages

1. V repozitáři otevřete **Settings → Pages → Build and deployment → Source: GitHub Actions**. Tím se aktivuje hostování.
2. Push do větve `main` automaticky spustí workflow **Test and publish tennis**, nebo ho spusťte ručně v Actions.
3. Workflow nejprve spustí testy, kontrolu syntaxe a sestavení, poté nasadí pouze veřejné herní soubory. Po úspěšném nasazení je hra dostupná na adrese uvedené výše.

Aktivace Pages vyžaduje oprávnění správce repozitáře. Samotný push či přítomnost workflow nejsou důkazem, že web už byl nasazen.
