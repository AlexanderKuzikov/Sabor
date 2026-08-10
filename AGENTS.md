# Sabor — Instructions for AI Agents

## Commands
- images:scan: `npm run images:scan`
- images:build: `npm run images:build`

## Conventions
- Static HTML/CSS/JS + PHP (admin.php, myip.php)
- Node >=18.17 ESM (cheerio, sharp) для build tooling
- Сайт аренды авто SABOR (Пермь)

## Structure
- HTML/CSS/JS — статика сайта
- `scripts/` — fetch-images.mjs
- `admin/` — веб-редактор цен
- `prices.json` — данные цен

## Do NOT touch
- `node_modules/`

## Documentation rules
- После работы — обнови docs/CONTEXT.md
- НЕ создавай новых файлов документации без разрешения
