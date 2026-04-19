# Локальные шрифты Google Fonts — инструкция

## Что скачивать из кэша

Google Fonts отдаёт шрифты разбитыми на файлы по наборам символов (subsets).
Для русскоязычного сайта нужно поймать **минимум два файла** — латиница и кириллица.
Они отличаются длиной хэша в имени, кириллический файл обычно длиннее.

Поймать файлы можно в DevTools → Network → фильтр `font` при загрузке страницы,
где шрифт подключён через Google Fonts CDN.

## Структура @font-face

Каждый файл нужно объявить **дважды** — для `font-weight: 400` и `font-weight: 700`.
Итого 4 блока (2 файла × 2 веса). Без `unicode-range` — браузер разберётся сам.

Блоки размещаются в **самом начале CSS**, до `:root`.

```css
@font-face {
  font-family: 'MyFont';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/ФАЙЛ-ЛАТИНИЦА.woff2') format('woff2');
}

@font-face {
  font-family: 'MyFont';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/ФАЙЛ-ЛАТИНИЦА.woff2') format('woff2');
}

@font-face {
  font-family: 'MyFont';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/ФАЙЛ-КИРИЛЛИЦА.woff2') format('woff2');
}

@font-face {
  font-family: 'MyFont';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/ФАЙЛ-КИРИЛЛИЦА.woff2') format('woff2');
}
```

## Подключение шрифта

В `:root` заменить переменную шрифта:

```css
:root {
  --font: 'MyFont', Arial, Helvetica, sans-serif;
}
```

Убедиться что `body` использует переменную:

```css
body {
  font-family: var(--font);
}
```

## Структура файлов на сервере

```
/fonts/
  ФАЙЛ-ЛАТИНИЦА.woff2
  ФАЙЛ-КИРИЛЛИЦА.woff2
/style.css
```

## Ловушки

| Проблема | Причина | Решение |
|---|---|---|
| Шрифты не грузятся вообще | Сломан CSS при редактировании | Работать с оригинальным файлом, не накапливать правки |
| `font-weight: 100 900` не работает | Файлы не variable font | Использовать конкретные значения: 400 и 700 |
| `unicode-range` — шрифты не грузятся | Неполный или неверный диапазон | Не использовать unicode-range — без него всё работает |
| Частичный фолбэк (одни символы есть, другие нет) | Каждый файл содержит только свой набор символов | Объявить оба файла для каждого веса (4 блока) |
| 404 на файлы локально | Абсолютный путь `/fonts/` не совпадает с корнем локального сервера | Проверить путь через браузер напрямую |

## Диагностика

Если шрифт не применяется:
1. DevTools → Elements → тег `<body>` → Computed → `font-family` — убедиться что там `MyFont`, а не Arial
2. DevTools → Network → фильтр `font` — убедиться что файлы запрашиваются и возвращают 200
3. Открыть `/fonts/ИМЯ-ФАЙЛА.woff2` напрямую в браузере — если скачивается, путь верный
