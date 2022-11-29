import * as express from 'express';
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

// TODO: cache items
const fetchItem = async (item: Partial<ItemView> & { link: string }): Promise<ItemView | undefined> => {
    const { link } = item;

    console.log('fetching', link);
    const response = await fetch(link);
    const content = await response.text();
    console.log('response', response.headers, content);
    const dom = new JSDOM(content);
    // console.log('dom', dom);
    const reader = new Readability(dom.window.document);
    const parseResult = reader.parse();

    console.log(JSON.stringify(parseResult, null, 2));

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

// assumes given url is a valid RSS feed
app.get('/rss/:root_rss', async (req, res) => {
    console.log('ohai', req.url, req.params);
    const response = await fetch(req.params.root_rss);
    const content = await response.text();
    // console.log('response', response.headers, content);

    const xml: { rss: { channel: RSSChannel } } = new XMLParser().parse(content);
    console.log(xml);
    const rssItems = xml.rss.channel.item.slice(0, 10);

    console.log('items', rssItems);

    const unfilteredItemViews = await Promise.all(rssItems.map(fetchItem));
    const items = unfilteredItemViews.filter((x): x is ItemView => !!x);

    const template = await readFile('feed.mustache', 'utf8');
    const feedView = {
        title: xml.rss.channel.title || req.params.root_rss,
        homepage_url: xml.rss.channel.link || req.params.root_rss,
        rss_url: req.params.root_rss,
        items
    };

    res.send(render(template, feedView));
});

app.listen(8080);
