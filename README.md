<p align="center">
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript"><img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black"></a>
  <a href="https://www.php.net"><img alt="PHP" src="https://img.shields.io/badge/PHP-777BB4?logo=php&logoColor=white"></a>
  <a href="https://github.com/AlexanderKuzikov/Sabor/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-blue"></a>
</p>

<h1 align="center">Sabor</h1>
<p align="center">Сайт аренды авто SABOR (Пермь) с image pipeline</p>

---

Сайт аренды автомобилей SABOR (Пермь). Статический фронтенд, PHP-бэкенд, Node ESM image pipeline для обработки изображений и веб-редактор цен.

- **Image pipeline** — автоматическая обработка изображений через sharp.
- **Веб-редактор цен** — управление ценами через браузерный интерфейс.
- **Статический фронтенд** — HTML/CSS/JS без фреймворков.

## Быстрый старт

```bash
git clone https://github.com/AlexanderKuzikov/Sabor.git
cd Sabor
npm install
npm run images:scan
npm run images:build
```

## Документация

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — состояние проекта
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — архитектурные решения

## Статус

**v1.0.0** — работает.

## Лицензия

[Apache-2.0](LICENSE) © Alexander Kuzikov
