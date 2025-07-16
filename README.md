# Art Institute of Chicago Browser Extension

![Art Institute of Chicago](https://raw.githubusercontent.com/Art-Institute-of-Chicago/template/master/aic-logo.gif)

A browser extension that presents a random work of art from the Art Institute of Chicago's collection in new tabs.

This extension is available in the [Chrome Web Store](https://chrome.google.com/webstore/detail/art-institute-of-chicago/abacageipbknolldcoehafgfjamoejad).

<!-- ![Screenshot of the extension in action ](docs/chromeNewTab.jpg) -->

<!-- ![Screenshot of Chrome Windows menu with Extensions highlighted](docs/chrome-setup-1.jpg) -->

<!-- ![Screenshot of the Extensions window ](docs/chrome-setup-2.jpg) -->

## Development

- Clone the project
- From Chrome menu choose Window - Extensions
- Toggle on "Developer Mode"
- Click "Load Unpacked"
- Select the browser-extension folder you cloned

## Background

In September 2019, the Art Institute of Chicago (AIC) launched its data API for public use. The API provides information and access to over 100,000 artworks.

Using the data API and [IIIF's image API](https://iiif.io), AIC's browser extension presents an artwork from the museum's collection in your browser every time a new tab is opened. The extension focuses on selecting from over 50,000 works marked for [public domain](https://www.artic.edu/image-licensing) use.

This repo serves as an example of using the Art Institute of Chicago's data API.

## Acknowledgements

AIC's browser extension was conceived in the Experience Design department during the 2018 internship program, Diversifying Art Museum Leadership Initiative (DAMLI).
Thanks to our intern, [Abdur Khan](https://github.com/AKhan139), for helping make this project possible.

Additional thanks to [Mark Dascoli](https://github.com/markdascoli), [Illya Moskvin](https://github.com/IllyaMoskvin), [Tina Shah](https://github.com/surreal8), Kirsten Southwell, and [nikhil trivedi](https://github.com/nikhiltri), for helping complete version 1 of the browser extension.

Inspiration for this project came from the following browser extension projects:

- [David Rumsey Map Collection - MapTab](https://chrome.google.com/webstore/detail/david-rumsey-map-collecti/fnheacjohhlddiffbmafmpoblbkfgmde?hl=en)
- [ueno.design](https://chrome.google.com/webstore/detail/uenodesign/iiekikakogelhkneknonedfhcajdlgda)
- [Muzli 2 - Stay Inspired](https://chrome.google.com/webstore/detail/muzli-2-stay-inspired/glcipcfhmopcgidicgdociohdoicpdfc)

The following tutorial helped us get started:
[How to Create and Publish a Chrome Extension in 20 minutes](https://www.freecodecamp.org/news/how-to-create-and-publish-a-chrome-extension-in-20-minutes-6dc8395d7153/) from [freeCodeCamp.org](https://freeCodeCamp.org)
