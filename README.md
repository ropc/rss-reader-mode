# RSS Reader Mode

Takes an RSS feed that just links to the actual posts and turns it into a RSS feed with the embedded content for each post

This is accomplished by fetching each post, parsing it with [Readability.js](https://github.com/mozilla/readability), and creating a feed with the reader mode version of the articles in each item

## Usage

```
npm start <rss url> <output feed path>
```
