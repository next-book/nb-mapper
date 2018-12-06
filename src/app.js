/**
 * App module used in node.js env.
 * @module
 * @ignore
 */

const Jsdom = require('jsdom').JSDOM;
const tagger = require('./tagger');
const gauge = require('./gauge');
const { getToc } = require('./toc');
const config = require('./config');
const Progress = require('cli-progress');
const pretty = require('pretty');
const slug = require('slug');
const gitRev = require('@destinationstransfers/git-rev-sync');
const hash = require('object-hash');

/**
 * Maps HTML for *next-book* use.
 *
 * @param      {string[]|JSDOM[]}  content   Array of *jsdom* objects or strings
 * @param      {array}             filenames Names of files from which content was read
 * @param      {config~Options}    options   The options
 * @return     {array}             Array of mapped documents in specified format
 * @public
 */
function map(content, filenames, options) {
  const conf = config.load(options);
  console.log(`\nUsing mapper config:\n${dumpArray(conf)}\n`);

  const doms = content.map(doc => getJsdomObj(doc));
  const documents = doms.map(dom => dom.window.document);
  const { chapters } = conf;

  // map
  console.log('Mapping documents:');
  const bar = new Progress.Bar({}, Progress.Presets.shades_classic);
  bar.start(documents.length, 0);

  documents.forEach((document, index) => {
    tagger.tagDocument(document, conf);
    gauge.gaugeDocument(document);

    bar.update(index + 1);
  });

  bar.stop();

  // gauge
  const lengths = gauge.gaugePublication(documents);
  const docMetadata = gatherMetadata(documents, filenames, chapters, lengths);
  const spine = composeSpine(conf.meta, docMetadata, sumPublication(docMetadata));

  // add nav
  addMetaNavigation(documents, docMetadata);

  return { spine, documents: exportDoms(doms, conf.output) };
}

function composeSpine(meta, documents, totals) {
  const id = [
    meta.author.split(' ').pop(),
    meta.title,
    meta.published,
    hash(meta).substring(0, 6),
  ].filter(str => str).join(' ');

  const time = new Date();

  return {
    ...meta,
    slug: slug(id, { lower: true }),
    revision: gitRev.short(),
    generatedAt: {
      date: String(time),
      unix: time.getTime(),
    },
    documents,
    totals,
  };
}

function sumPublication(metadata) {
  return metadata.reduce((totals, document) => {
    totals.all.words += document.words;
    totals.all.chars += document.chars;
    if (document.isChapter) {
      totals.chapters.words += document.words;
      totals.chapters.chars += document.chars;
    }
    return totals;
  }, {
    all: { words: 0, chars: 0 },
    chapters: { words: 0, chars: 0 },
  });
}

function gatherMetadata(documents, filenames, chapters, lengths) {
  console.log('\nGathering metadata…');

  return documents.map((document, index) => {
    const title = document.querySelector('title').textContent;
    const file = filenames[index];
    const { words, chars } = lengths[index];
    const toc = getToc(document);

    const isChapter = chapters.includes(filenames[index]);
    const pos = chapters.indexOf(filenames[index]);
    const order = isChapter ? pos + 1 : 0;

    const prev = pos !== 0 ? chapters[pos - 1] : null;
    const next = pos < chapters.length - 1
      ? chapters[pos + 1]
      : filenames[index] === 'index.html'
        ? chapters[0]
        : null;

    return {
      title,
      file,
      words,
      chars,
      isChapter,
      order,
      prev,
      next,
      toc,
    };
  });
}

function addMetaNavigation(documents, metadata) {
  console.log('\nAdding meta navigation…');

  const base = [
    { tagName: 'link', rel: 'index', href: './index.html' },
    { tagName: 'link', rel: 'license', href: './license.html' },
    {
      tagName: 'link',
      rel: 'import',
      href: './spine.json',
      id: 'spine',
    },
  ];

  documents.forEach((document, index) => {
    const extra = Object.keys(metadata[index])
      .filter(name => metadata[index][name])
      .map((name) => {
        const value = metadata[index][name];
        return ['prev', 'next'].includes(name)
          ? { tagName: 'link', rel: name, href: `./${value}` }
          : name === 'order'
            ? { tagName: 'meta', name, content: value }
            : null;
      });

    base.concat(extra).forEach((meta) => {
      if (meta === null) return;

      const el = document.createElement(meta.tagName);
      Object.keys(meta)
        .filter(key => ['name', 'content', 'rel', 'href', 'id']
          .includes(key)).forEach((key) => {
          el.setAttribute(key, meta[key]);
        });
      document.querySelector('head').appendChild(el);
    });
  });
}


/**
 * Converts HTML string into jsdom object if needed.
 *
 * @param      {(string|JSDOM)}  doc     The document
 * @return     {JSDOM}           Returns a new jsdom object.
 * @private
 */
function getJsdomObj(doc) {
  if (Object.prototype.isPrototypeOf.call(doc, Jsdom)) return doc.cloneNode(true);
  else if (typeof doc === 'string') return new Jsdom(doc);

  throw new Error('Input document format not recognized!');
}

/**
 * Export DOM objects in a specified format
 *
 * @param      {JSDOM[]}           doms    DOM objects
 * @param      {('jsdom'|'html')}  format  Output format
 * @return     {array}             Array of JSDOM objects or HTML strings
 * @private
 */
function exportDoms(doms, format) {
  console.log('\nExporting HTML…');

  const routines = {
    jsdom: dom => dom,
    html: dom => pretty(dom.serialize(), { ocd: true }),
  };

  return doms.map(dom => routines[format](dom));
}


function dumpArray(arr) {
  return JSON.stringify(arr, null, 2).split('\n').map(line => `>${line}`).join('\n');
}

module.exports = { map, addMetaNavigation };
