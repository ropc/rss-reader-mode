import express from 'express';
import memoize from 'memoizee';
import stringify from 'json-stable-stringify';
import { XMLParser } from 'fast-xml-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { render } from 'mustache';
import { readFile } from 'node:fs/promises';

const app = express();

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

const unmemoizedFetchItem = async (item: Partial<ItemView> & { link: string }, selectorsString: string): Promise<ItemView | undefined> => {
    const { link } = item;
    const selectors = selectorsString.split(';');
    console.log('fetching:', link, 'selectors:', selectors);
    const response = await fetch(link);
    const content = await response.text();
    // console.log('response', response.headers, content);
    const dom = new JSDOM(content);
    let document = dom.window.document.querySelector('body');
    if (!document) {
        return;
    }
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
    // console.log('dom', dom);
    const reader = new Readability(dom.window.document);
    const parseResult = reader.parse();

    console.log('finished parsing', link, 'successful:', !!parseResult);

    if (!parseResult) {
        return;
    }

    return {
        ...parseResult,
        description: parseResult.excerpt,
        pubDate: new Date().toISOString(),
        author: parseResult.byline,
        ...item
    };
};

const fetchItem = memoize(unmemoizedFetchItem, { promise: true, normalizer: (args) => stringify(args[0]) + args[1] });


// assumes given url is a valid RSS feed
app.get('/rss', async (req, res) => {
    console.log('ohai', req.url, req.query);
    const root_rss = req.query?.['root_rss'];
    if (!root_rss || typeof root_rss !== 'string') {
        return;
    }
    const response = await fetch(root_rss);
    const content = await response.text();
    // console.log('response', response.headers, content);

    const xml: { rss: { channel: RSSChannel } } = new XMLParser().parse(content);
    console.log(xml);
    const rssItems = xml.rss.channel.item.slice(0, 50);

    console.log('found', rssItems.length, 'items');

    const unfilteredItemViews = await Promise.all(rssItems.map((item) => fetchItem(item, '')));
    const items = unfilteredItemViews.filter((x): x is ItemView => !!x);

    const template = await readFile('feed.mustache', 'utf8');
    const feedView = {
        title: xml.rss.channel.title || root_rss,
        homepage_url: xml.rss.channel.link || root_rss,
        rss_url: root_rss,
        items
    };

    res.send(render(template, feedView));
});

app.listen(8080);
