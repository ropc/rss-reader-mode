import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { render } from 'mustache';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';


interface RSSChannel {
    title: string;
    link: string;
    description: string;
    item: RSSItem[];
}

interface RSSItem {
    title: string;
    link: string,
    guid?: string,
    pubDate: string,
    description: string;
}

interface ItemView extends RSSItem {
    author: string;
    content: string;
}

interface ETagCache {
    [url: string]: string
}

interface Config {
    [url: string]: string;  // url -> output file path
}

const fetchItem = async (item: Partial<ItemView> & { link: string }, selectorsString: string): Promise<ItemView | undefined> => {
    const { link } = item;
    const selectors = selectorsString.split(';');
    console.debug('fetching:', link, 'selectors:', selectors);
    const response = await fetch(link);
    const content = await response.text();
    const dom = new JSDOM(content);
    let document = dom.window.document.querySelector('body');
    if (!document) {
        return;
    }
    // selector logic
    for (const selector of selectors) {
        if (selector.trim().length === 0) {
            continue;
        }
        const isSelectingContent = selector.startsWith('+');
        if (isSelectingContent) {
            document = document.querySelector(selector.slice(1)) || document;
        } else {
            document.querySelectorAll(selector.slice(1)).forEach(element => element.remove());
        }
    }
    const reader = new Readability(dom.window.document);
    const parseResult = reader.parse();

    console.debug('finished parsing', link, 'successful:', !!parseResult);

    if (!parseResult) {
        return;
    }

    return {
        ...parseResult,
        ...item,
        description: parseResult.excerpt,
        pubDate: new Date().toISOString(),
        author: parseResult.byline,
        guid: item.guid ?? item.link,
    };
};

const loadETag = async (url: string): Promise<string | undefined> => {
    if (!existsSync('etag-cache.json')) {
        return undefined;
    }
    const file = await readFile('etag-cache.json', 'utf8');
    const cache: ETagCache = JSON.parse(file);
    return cache[url];
}

const saveETag = async (url: string, etag: string) => {
    const file = existsSync('etag-cache.json')
        ? await readFile('etag-cache.json', 'utf8')
        : "{}";
    const cache: ETagCache = JSON.parse(file);
    cache[url] = etag;
    await writeFile('etag-cache.json', JSON.stringify(cache), 'utf8');
}

// assumes given url is a valid RSS feed
const runSingle = async (root_rss: string, output_file: string) => {
    const etag = await loadETag(root_rss);
    console.info('fetching', root_rss, 'etag:', etag);
    const response = await fetch(root_rss, {
        headers: etag ? { "If-None-Match": etag } : undefined
    });
    if (response.status === 304) {
        console.info(`rss feed ${root_rss} has not changed, nothing to update`);
        return;
    }
    const content = await response.text();

    const xml: { rss: { channel: RSSChannel } } = new XMLParser().parse(content);
    const rssItems = xml.rss.channel.item.slice(0, 50);

    console.info('got', root_rss, 'feed with', rssItems.length, 'items:', xml);

    const unfilteredItemViews = await Promise.all(rssItems.map((item) => fetchItem(item, '')));
    const items = unfilteredItemViews.filter((x): x is ItemView => !!x);

    const template = await readFile('feed.mustache', 'utf8');
    const feedView = {
        title: xml.rss.channel.title || root_rss,
        homepage_url: xml.rss.channel.link || root_rss,
        rss_url: root_rss,
        items
    };

    const output_rss = render(template, feedView);
    await writeFile(output_file, output_rss, 'utf8');

    const newETag = response.headers.get('ETag');
    if (newETag) {
        await saveETag(root_rss, newETag);
        console.debug(root_rss, 'saved etag', newETag);
    }
};

const runBatch = async (config_path: string) => {
    const file = existsSync(config_path)
        ? await readFile(config_path, 'utf8')
        : "{}";
    const config: Config = JSON.parse(file);
    const promises = Object.keys(config).map(url => runSingle(url, config[url]!))
    return Promise.all(promises);
};

if (!argv[2]) {
    throw new Error(`not enough arguments: ${argv}`);
}

if (argv[3]) {
    runSingle(argv[2], argv[3]);
} else {
    runBatch(argv[2]);
}
