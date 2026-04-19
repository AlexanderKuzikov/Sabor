import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const SITE_ORIGIN = 'https://saborauto.ru';
const SITE_HOST = new URL(SITE_ORIGIN).host;

const PAGE_URLS = [
  `${SITE_ORIGIN}/`,
  `${SITE_ORIGIN}/arenda-i-prokat-avtomobilej-v-permi/`,
  `${SITE_ORIGIN}/usloviya-arendy/`,
  `${SITE_ORIGIN}/kontakty/`
];

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, 'img');
const CARS_DIR = path.join(OUTPUT_DIR, 'cars');
const COMMON_DIR = path.join(OUTPUT_DIR, 'common');
const MANIFEST_JSON = path.join(OUTPUT_DIR, '_manifest.json');
const MANIFEST_CSV = path.join(OUTPUT_DIR, '_manifest.csv');

const args = parseArgs(process.argv.slice(2));

const MODE = args.mode || 'build';
const QUALITY = Number(args.quality || 82);
const TIMEOUT = Number(args.timeout || 20000);
const CAR_WIDTHS = parseWidths(args.carWidths, [320, 480, 600]);
const COMMON_WIDTH = Number(args.commonWidth || 1200);
const CLEAR_OUTPUT = Boolean(args.clear);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif', '.svg'
]);

const CAR_TERMS = [
  'kia', 'rio',
  'hyundai', 'solaris',
  'skoda', 'rapid',
  'moskvich', 'москвич',
  'volkswagen', 'polo',
  'changan', 'lamora', 'lamore', 'eado',
  'автомобиль', 'авто', 'машина', 'car'
];

const CSS_URL_RE = /url\(([^)]+)\)/gi;
const IMPORT_RE = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?/gi;

const seenCss = new Set();
const seenPages = new Set();
const assetMap = new Map();
const usedNames = new Set();

await main();

async function main() {
  if (CLEAR_OUTPUT) {
    await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  }

  for (const pageUrl of PAGE_URLS) {
    await collectFromPage(pageUrl);
  }

  const assets = [...assetMap.values()]
    .filter(asset => !!asset.url)
    .sort((a, b) => a.url.localeCompare(b.url));

  await ensureDir(OUTPUT_DIR);

  if (MODE === 'scan') {
    const scanManifest = assets.map(toScanManifestRow);

    await writeJson(MANIFEST_JSON, {
      generatedAt: new Date().toISOString(),
      mode: 'scan',
      siteOrigin: SITE_ORIGIN,
      pages: PAGE_URLS,
      responsive: {
        cars: CAR_WIDTHS,
        commonWidth: COMMON_WIDTH
      },
      assets: scanManifest
    });

    await writeCsv(MANIFEST_CSV, scanManifest);

    console.log(`SCAN: найдено ${assets.length} уникальных ресурсов.`);
    console.log(`JSON: ${relativeToRoot(MANIFEST_JSON)}`);
    console.log(`CSV: ${relativeToRoot(MANIFEST_CSV)}`);
    return;
  }

  await ensureDir(CARS_DIR);
  await ensureDir(COMMON_DIR);

  const builtAssets = [];

  for (const asset of assets) {
    try {
      const built = await downloadAndBuildAsset(asset);
      builtAssets.push(built);
      console.log(`OK  ${built.oldUrl} -> ${built.src}`);
    } catch (error) {
      builtAssets.push({
        status: `error: ${error.message}`,
        type: asset.folder === 'cars' ? 'responsive-image' : 'image',
        folder: asset.folder,
        oldUrl: asset.url,
        sourcePages: [...asset.sourcePages],
        name: asset.fileStem,
        ext: '',
        src: '',
        srcset: '',
        sizes: asset.folder === 'cars'
          ? '(min-width: 75rem) 18rem, (min-width: 48rem) 50vw, 100vw'
          : '100vw',
        width: '',
        height: '',
        bytes: '',
        contentType: '',
        variants: [],
        context: asset.primaryContext
      });
      console.error(`ERR ${asset.url} -> ${error.message}`);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: 'build',
    siteOrigin: SITE_ORIGIN,
    pages: PAGE_URLS,
    responsive: {
      cars: CAR_WIDTHS,
      commonWidth: COMMON_WIDTH
    },
    assets: builtAssets
  };

  await writeJson(MANIFEST_JSON, manifest);
  await writeCsv(MANIFEST_CSV, builtAssets);

  console.log(`BUILD: обработано ${builtAssets.length} ресурсов.`);
  console.log(`JSON: ${relativeToRoot(MANIFEST_JSON)}`);
  console.log(`CSV: ${relativeToRoot(MANIFEST_CSV)}`);
}

async function collectFromPage(pageUrl) {
  if (seenPages.has(pageUrl)) return;
  seenPages.add(pageUrl);

  const html = await fetchText(pageUrl, 'text/html,application/xhtml+xml');
  const $ = cheerio.load(html, { decodeEntities: false });
  const pageTitle = $('title').first().text().trim();
  const pageSlug = getPageSlug(pageUrl);

  $('img, source').each((_, el) => {
    const node = $(el);

    const candidates = [
      node.attr('src'),
      node.attr('data-src'),
      node.attr('data-lazy-src'),
      node.attr('data-original'),
      node.attr('data-lazyload')
    ].filter(Boolean);

    const srcsetCandidates = [
      node.attr('srcset'),
      node.attr('data-srcset'),
      node.attr('data-lazy-srcset')
    ].filter(Boolean);

    for (const src of candidates) {
      addAssetCandidate(src, pageUrl, pageSlug, pageTitle, extractContext($, el, pageUrl));
    }

    for (const srcset of srcsetCandidates) {
      const best = pickBestSrcsetCandidate(srcset);
      if (best) {
        addAssetCandidate(best, pageUrl, pageSlug, pageTitle, extractContext($, el, pageUrl));
      }
    }
  });

  $('[style]').each((_, el) => {
    const style = ($(el).attr('style') || '').trim();
    if (!style || !style.includes('url(')) return;

    const urls = extractCssUrls(style, pageUrl);
    for (const item of urls) {
      addAssetCandidate(item, pageUrl, pageSlug, pageTitle, extractContext($, el, pageUrl, true));
    }
  });

  const stylesheetUrls = new Set();

  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized && isFetchableStylesheet(normalized)) {
      stylesheetUrls.add(normalized);
    }
  });

  for (const cssUrl of stylesheetUrls) {
    await collectFromStylesheet(cssUrl, pageUrl, pageSlug, pageTitle);
  }
}

async function collectFromStylesheet(cssUrl, sourcePageUrl, pageSlug, pageTitle) {
  if (seenCss.has(cssUrl)) return;
  seenCss.add(cssUrl);

  let cssText = '';

  try {
    cssText = await fetchText(cssUrl, 'text/css,*/*;q=0.1');
  } catch {
    return;
  }

  const importedCss = [];
  let importMatch;

  while ((importMatch = IMPORT_RE.exec(cssText)) !== null) {
    const href = cleanCssUrl(importMatch[1]);
    const normalized = normalizeUrl(href, cssUrl);
    if (normalized && isFetchableStylesheet(normalized)) {
      importedCss.push(normalized);
    }
  }

  const cssUrls = extractCssUrls(cssText, cssUrl);

  for (const resourceUrl of cssUrls) {
    addAssetCandidate(resourceUrl, sourcePageUrl, pageSlug, pageTitle, {
      source: 'stylesheet',
      pageUrl: sourcePageUrl,
      pageSlug,
      pageTitle,
      title: '',
      alt: '',
      heading: '',
      text: path.basename(new URL(resourceUrl).pathname)
    });
  }

  for (const imported of importedCss) {
    await collectFromStylesheet(imported, sourcePageUrl, pageSlug, pageTitle);
  }
}

function addAssetCandidate(rawUrl, sourcePageUrl, pageSlug, pageTitle, context = {}) {
  const normalized = normalizeUrl(rawUrl, sourcePageUrl);
  if (!normalized) return;
  if (!isImageUrl(normalized)) return;

  const existing = assetMap.get(normalized);

  const mergedContext = {
    source: context.source || 'html',
    pageUrl: sourcePageUrl,
    pageSlug,
    pageTitle,
    title: context.title || '',
    alt: context.alt || '',
    heading: context.heading || '',
    text: context.text || ''
  };

  if (existing) {
    existing.sourcePages.add(sourcePageUrl);
    existing.contexts.push(mergedContext);
    if (shouldUpgradeContext(existing.primaryContext, mergedContext)) {
      existing.primaryContext = mergedContext;
    }
    return;
  }

  const folder = detectFolder(normalized, mergedContext);
  const fileStem = createUniqueStem(buildBaseStem(normalized, mergedContext, folder), folder);

  assetMap.set(normalized, {
    url: normalized,
    folder,
    fileStem,
    sourcePages: new Set([sourcePageUrl]),
    contexts: [mergedContext],
    primaryContext: mergedContext
  });
}

async function downloadAndBuildAsset(asset) {
  const response = await fetchWithTimeout(asset.url, {
    headers: {
      'user-agent': userAgent(),
      'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const originalExt = extensionFromUrlOrType(asset.url, contentType);
  const folderPath = asset.folder === 'cars' ? CARS_DIR : COMMON_DIR;

  await ensureDir(folderPath);

  if (originalExt === '.svg' || contentType.includes('image/svg')) {
    const fileName = `${asset.fileStem}.svg`;
    const outputPath = path.join(folderPath, fileName);
    const svgText = await response.text();

    await fs.writeFile(outputPath, svgText, 'utf8');

    const stat = await fs.stat(outputPath);

    return {
      status: 'ok',
      type: 'vector-image',
      folder: asset.folder,
      oldUrl: asset.url,
      sourcePages: [...asset.sourcePages],
      name: asset.fileStem,
      ext: '.svg',
      src: toWebPath(outputPath),
      srcset: '',
      sizes: '',
      width: '',
      height: '',
      bytes: stat.size,
      contentType: 'image/svg+xml',
      variants: [
        {
          width: '',
          height: '',
          bytes: stat.size,
          path: toWebPath(outputPath)
        }
      ],
      context: asset.primaryContext
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const baseImage = sharp(buffer, { failOn: 'none' }).rotate();
  const metadata = await baseImage.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Не удалось определить размеры изображения');
  }

  const variantWidths = getVariantWidths(asset.folder, metadata.width);
  const variants = [];

  for (const width of variantWidths) {
    const fileName = `${asset.fileStem}-${width}.webp`;
    const outputPath = path.join(folderPath, fileName);

    await baseImage
      .clone()
      .resize({
        width,
        withoutEnlargement: true
      })
      .webp({ quality: QUALITY })
      .toFile(outputPath);

    const outputMeta = await sharp(outputPath).metadata();
    const stat = await fs.stat(outputPath);

    variants.push({
      width: outputMeta.width || width,
      height: outputMeta.height || '',
      bytes: stat.size,
      path: toWebPath(outputPath)
    });
  }

  variants.sort((a, b) => Number(a.width) - Number(b.width));

  const largest = variants[variants.length - 1];
  const isCar = asset.folder === 'cars';

  return {
    status: 'ok',
    type: isCar ? 'responsive-image' : 'image',
    folder: asset.folder,
    oldUrl: asset.url,
    sourcePages: [...asset.sourcePages],
    name: asset.fileStem,
    ext: '.webp',
    src: largest.path,
    srcset: isCar ? variants.map(item => `${item.path} ${item.width}w`).join(', ') : '',
    sizes: isCar
      ? '(min-width: 75rem) 18rem, (min-width: 48rem) 50vw, 100vw'
      : '100vw',
    width: largest.width,
    height: largest.height,
    bytes: largest.bytes,
    contentType: 'image/webp',
    variants,
    context: asset.primaryContext
  };
}

function getVariantWidths(folder, originalWidth) {
  if (!originalWidth || Number.isNaN(originalWidth)) {
    return folder === 'cars' ? [CAR_WIDTHS[0]] : [COMMON_WIDTH];
  }

  if (folder !== 'cars') {
    return [Math.min(originalWidth, COMMON_WIDTH)];
  }

  const widths = new Set();

  for (const targetWidth of CAR_WIDTHS) {
    if (targetWidth < originalWidth) {
      widths.add(targetWidth);
    }
  }

  widths.add(Math.min(originalWidth, CAR_WIDTHS[CAR_WIDTHS.length - 1]));

  return [...widths].filter(Boolean).sort((a, b) => a - b);
}

function extractContext($, el, pageUrl, isBackground = false) {
  const node = $(el);
  const pageSlug = getPageSlug(pageUrl);
  const pageTitle = $('title').first().text().trim();

  const title = [
    node.attr('title'),
    node.attr('aria-label'),
    node.attr('data-title')
  ].find(Boolean) || '';

  const alt = [
    node.attr('alt'),
    node.attr('data-alt'),
    node.attr('data-image-title')
  ].find(Boolean) || '';

  const closestHeading = node
    .closest('figure, article, section, li, div')
    .find('h1, h2, h3, h4, h5, h6')
    .first()
    .text()
    .trim();

  const siblingHeading = node
    .parent()
    .find('h1, h2, h3, h4, h5, h6')
    .first()
    .text()
    .trim();

  const textChunk = compactText(
    [
      title,
      alt,
      closestHeading,
      siblingHeading,
      node.parent().text(),
      node.closest('figure, article, section, li, div').text(),
      pageTitle,
      pageSlug
    ].join(' ')
  );

  return {
    source: isBackground ? 'inline-style' : 'html',
    pageUrl,
    pageSlug,
    pageTitle,
    title,
    alt,
    heading: closestHeading || siblingHeading || '',
    text: textChunk
  };
}

function detectFolder(url, context) {
  const haystack = [
    url,
    context.pageSlug,
    context.pageTitle,
    context.heading,
    context.alt,
    context.title,
    context.text
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return CAR_TERMS.some(term => haystack.includes(term.toLowerCase())) ? 'cars' : 'common';
}

function buildBaseStem(url, context, folder) {
  const fileBase = safeBasename(url);

  const contextCandidates = [
    context.heading,
    context.alt,
    context.title,
    firstMeaningfulLine(context.text),
    fileBase
  ]
    .map(v => compactText(v || ''))
    .filter(Boolean);

  let stem = slugify(contextCandidates[0] || fileBase);

  if (!stem || stem.length < 3) {
    stem = slugify(fileBase || 'image');
  }

  if (folder === 'common') {
    const pagePrefix = slugify(context.pageSlug || 'site');
    const looksGeneric = ['image', 'img', 'photo', 'logo', 'banner', 'icon'].includes(stem);
    if (looksGeneric || stem.length < 5) {
      stem = `${pagePrefix}-${stem}`;
    }
  }

  return stem.slice(0, 90) || `image-${Date.now()}`;
}

function createUniqueStem(baseStem, folder) {
  let candidate = baseStem;
  let index = 2;

  while (usedNames.has(`${folder}/${candidate}`)) {
    candidate = `${baseStem}-${index}`;
    index += 1;
  }

  usedNames.add(`${folder}/${candidate}`);
  return candidate;
}

function pickBestSrcsetCandidate(srcset) {
  const candidates = parseSrcset(srcset);
  if (!candidates.length) return '';

  return candidates
    .sort((a, b) => (b.width || 0) - (a.width || 0))
    .map(item => item.url)
    .find(Boolean) || '';
}

function parseSrcset(srcset) {
  return String(srcset)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [url, descriptor] = part.split(/\s+/);
      const width = descriptor && descriptor.endsWith('w')
        ? Number(descriptor.replace('w', ''))
        : 0;
      return { url, width };
    });
}

function extractCssUrls(text, baseUrl) {
  const urls = [];
  let match;

  while ((match = CSS_URL_RE.exec(text)) !== null) {
    const raw = cleanCssUrl(match[1]);
    const normalized = normalizeUrl(raw, baseUrl);
    if (normalized && isImageUrl(normalized)) {
      urls.push(normalized);
    }
  }

  return [...new Set(urls)];
}

function cleanCssUrl(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function normalizeUrl(raw, baseUrl) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (!value) return '';
  if (value.startsWith('data:')) return '';
  if (value.startsWith('blob:')) return '';
  if (value.startsWith('mailto:')) return '';
  if (value.startsWith('tel:')) return '';
  if (value.startsWith('javascript:')) return '';

  try {
    const absolute = new URL(value, baseUrl);
    absolute.hash = '';
    if (absolute.host !== SITE_HOST) return '';
    return absolute.toString();
  } catch {
    return '';
  }
}

function isFetchableStylesheet(url) {
  try {
    const parsed = new URL(url);
    return parsed.host === SITE_HOST && parsed.pathname.toLowerCase().endsWith('.css');
  } catch {
    return false;
  }
}

function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function extensionFromUrlOrType(url, contentType) {
  if (contentType.includes('image/svg')) return '.svg';
  if (contentType.includes('image/jpeg')) return '.jpg';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/webp')) return '.webp';
  if (contentType.includes('image/gif')) return '.gif';
  if (contentType.includes('image/avif')) return '.avif';
  if (contentType.includes('image/bmp')) return '.bmp';
  if (contentType.includes('image/tiff')) return '.tiff';

  try {
    return path.extname(new URL(url).pathname).toLowerCase() || '.img';
  } catch {
    return '.img';
  }
}

function safeBasename(url) {
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname, path.extname(parsed.pathname));
    return basename || 'image';
  } catch {
    return 'image';
  }
}

function getPageSlug(pageUrl) {
  try {
    const pathname = new URL(pageUrl).pathname;
    const cleaned = pathname.replace(/^\/|\/$/g, '');
    return cleaned || 'home';
  } catch {
    return 'page';
  }
}

function shouldUpgradeContext(current, next) {
  const score = ctx => {
    if (!ctx) return 0;
    return [ctx.heading, ctx.alt, ctx.title, ctx.text]
      .filter(Boolean)
      .join(' ')
      .trim()
      .length;
  };

  return score(next) > score(current);
}

function compactText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, ' ')
    .trim();
}

function firstMeaningfulLine(value) {
  const text = compactText(value);
  if (!text) return '';
  return text.split('. ')[0].slice(0, 120).trim();
}

function slugify(value) {
  const translitMap = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'cz', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[а-яё]/g, char => translitMap[char] || '')
    .replace(/&/g, ' and ')
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function parseArgs(argv) {
  return argv.reduce((acc, part) => {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey.replace(/^--/, '');
    const value = rawValue === undefined ? true : rawValue;
    acc[key] = value;
    return acc;
  }, {});
}

function parseWidths(value, defaults) {
  if (!value) return defaults;
  return String(value)
    .split(',')
    .map(item => Number(item.trim()))
    .filter(Boolean)
    .sort((a, b) => a - b);
}

async function fetchText(url, accept = '*/*') {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': userAgent(),
      'accept': accept
    }
  });

  if (!response.ok) {
    throw new Error(`Не удалось получить ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function userAgent() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36 SaborStaticBuilder/1.2';
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function writeCsv(filePath, rows) {
  await ensureDir(path.dirname(filePath));

  const headers = [
    'status',
    'type',
    'folder',
    'name',
    'ext',
    'src',
    'srcset',
    'sizes',
    'oldUrl',
    'sourcePages',
    'width',
    'height',
    'bytes',
    'contentType'
  ];

  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(key => csvEscape(formatCsvValue(row[key]))).join(','))
  ];

  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
}

function formatCsvValue(value) {
  if (Array.isArray(value)) return value.join(' | ');
  if (value === undefined || value === null) return '';
  return String(value);
}

function csvEscape(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toWebPath(filePath) {
  return '/' + path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function relativeToRoot(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function toScanManifestRow(asset) {
  const responsive = asset.folder === 'cars';
  const predictedWidths = responsive ? CAR_WIDTHS : [COMMON_WIDTH];

  const predictedVariants = predictedWidths.map(width => ({
    width,
    height: '',
    bytes: '',
    path: asset.folder === 'cars'
      ? `/img/cars/${asset.fileStem}-${width}.webp`
      : `/img/common/${asset.fileStem}-${width}.webp`
  }));

  return {
    status: 'found',
    type: responsive ? 'responsive-image' : 'image',
    folder: asset.folder,
    name: asset.fileStem,
    ext: '.webp',
    src: predictedVariants[predictedVariants.length - 1].path,
    srcset: responsive
      ? predictedVariants.map(item => `${item.path} ${item.width}w`).join(', ')
      : '',
    sizes: responsive
      ? '(min-width: 75rem) 18rem, (min-width: 48rem) 50vw, 100vw'
      : '100vw',
    oldUrl: asset.url,
    sourcePages: [...asset.sourcePages],
    width: '',
    height: '',
    bytes: '',
    contentType: '',
    variants: predictedVariants,
    context: asset.primaryContext
  };
}
