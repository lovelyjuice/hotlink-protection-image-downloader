[中文简介](README_CN.md)

# Hotlink Protection Image Downloader
For websites with anti-leech protection, such as ShaoNv Pai, images from web pages copied into articles cannot be displayed. Additionally, I have seen many users' "image beds" suddenly enabling anti-leech, causing existing notes to be unreadable. Therefore, this plugin was born. Although I have never written an Obsidian plugin before and am not very familiar with JavaScript, I managed to write this plugin with the help of large language models and some pieced-together knowledge.

## What is it for
The functionality is very simple. It identifies URLs in the note or allows the user to manually input a URL as the Referer, downloads the image to the local machine, and then replaces the image link with the local image path. The downloaded images will be saved in Obsidian's default attachment folder, just like directly copying images from a web page and pasting them in.

If the note's properties contain a value starting with "http", it will be used as the Referer, and no popup will be required to ask the user to input the Referer.
If there is no such property, the plugin will look for the first URL starting with http in the first 200 characters of the note. However, this may not be accurate, so a popup will be required to confirm.

## How to Use
Open a document, press Ctrl+P and type hotlink

## Notes
Since several built-in libraries of node.js, such as https, are used, this plugin cannot be used on mobile devices. This drawback cannot be avoided because the browser's security policy does not allow the modification of the Referer. The built-in fetch function of js and the requestUrl API of Obsidian cannot bypass this security restriction.