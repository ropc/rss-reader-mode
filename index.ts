import * as express from 'express';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { render } from 'mustache';
import { readFile } from 'node:fs/promises';

const app = express();

app.get('/rss/:root', async (req, res) => {
    console.log('ohai', req.url, req.params);
    const response = await fetch(req.params.root);
    const content = await response.text();
    // console.log('response', response.headers, content);
    const dom = new JSDOM(content);
    // console.log('dom', dom);
    const reader = new Readability(dom.window.document);
    const parseResult = reader.parse();

    console.log(JSON.stringify(parseResult, null, 2));

    if (!parseResult) {
        res.sendStatus(500);
        return;
    }

    const template = await readFile('feed.mustache', 'utf8');
    const feedView = {
        title: req.params.root,
        homepage_url: req.params.root,
        rss_url: req.params.root,
        items: [
            {
                ...parseResult,
                description: parseResult.excerpt,
                url: req.params.root,
                date: new Date(),
                author: parseResult.byline,

            }
        ]
    };

    res.send(render(template, feedView));
});

app.listen(8080);
