"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FreeWebNovelInfo = exports.FreeWebNovel = void 0;
const paperback_extensions_common_1 = require("paperback-extensions-common");
const FreeWebNovelResponseInterceptor_1 = require("./FreeWebNovelResponseInterceptor");
const WEBSITE_URL = "https://freewebnovel.com";
const REQUEST_RETRIES = 3;
const SETTINGS = {
    textColor: ["White", "Light Gray", "Brown", "Dark Gray", "Black"],
    backgroundColor: ["White", "Sepia", "Dark Gray", "Black"],
    fontSize: ["18", "24", "30", "36"],
    font: ["Arial", "Georgia", "San Francisco", "Times New Roman"]
};
const COLORS = {
    white: 0xFFFFFF,
    light_gray: 0xDDDDDD,
    brown: 0x4C3320,
    sepia: 0xF2E5C9,
    dark_gray: 0x444444,
    black: 0x000000
};
class FreeWebNovel extends paperback_extensions_common_1.Source {
    constructor() {
        super(...arguments);
        this.requestManager = createRequestManager({
            requestsPerSecond: 10,
            requestTimeout: 10000,
            interceptor: {
                interceptRequest: async (request) => { return request; },
                interceptResponse: async (response) => {
                    return (0, FreeWebNovelResponseInterceptor_1.interceptResponse)(response, this.cheerio, {
                        textColor: COLORS[(await getTextColor(this.stateManager)).toLowerCase().replace(/ /g, "_")],
                        backgroundColor: COLORS[(await getBackgroundColor(this.stateManager)).toLowerCase().replace(/ /g, "_")],
                        font: `${(await getFont(this.stateManager)).toLowerCase().replace(/ /g, "")}${await getFontSize(this.stateManager)}`,
                        padding: {
                            horizontal: await getHorizontalPadding(this.stateManager),
                            vertical: await getVerticalPadding(this.stateManager)
                        },
                        width: await getImageWidth(this.stateManager),
                        constantWidth: true,
                        lines: await getLinesPerPage(this.stateManager)
                    });
                }
            }
        });
        this.stateManager = createSourceStateManager({});
    }
    async getSourceMenu() {
        return styleSettings(this.stateManager);
    }
    async getMangaDetails(mangaId) {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${mangaId}.html`,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const htmlInfo = $('div.m-book1');
        const titles = [$('h1.tit', htmlInfo).text()];
        const tagStrings = [];
        let status = paperback_extensions_common_1.MangaStatus.UNKNOWN;
        let author = undefined;
        const list = $('div.m-imgtxt > div.txt > div', htmlInfo).toArray();
        for (let object of list) {
            console.log(`checking "${$('span.glyphicon', object).attr('title')}", attribute is "${$('div.right', object).text()}"`);
            switch ($('span.glyphicon', object).attr('title')) {
                case 'Alternative names':
                    titles.push(...($('div.right', object).text().split(', ')));
                    break;
                case 'Author':
                    author = $('div.right', object).text();
                    break;
                case 'Genre':
                    tagStrings.push(...($('div.right', object).text().split(', ')));
                    break;
                case 'Status':
                    status = $('div.right', object).text().toLowerCase() === 'completed' ? paperback_extensions_common_1.MangaStatus.COMPLETED : paperback_extensions_common_1.MangaStatus.ONGOING;
                    break;
            }
        }
        const tags = [];
        for (let tag of tagStrings) {
            tags.push(createTag({ id: tag, label: tag.replace(/\n/g, "") }));
        }
        return createManga({
            id: mangaId,
            titles: titles,
            image: $('div.pic > img', htmlInfo).attr('src') ?? "",
            status: status,
            author: author,
            tags: tags.length === 0 ? undefined : [createTagSection({ id: 'genres', label: 'Genres', tags: tags })]
        });
    }
    async getChapters(mangaId) {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${mangaId}.html`,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        let $ = this.cheerio.load(response.data);
        const chapterPages = $('div.page > select > option').toArray();
        const chapters = [];
        const responses = [];
        while (chapterPages.length > 0) {
            const option = chapterPages.shift();
            const newRequest = createRequestObject({
                url: `${WEBSITE_URL}${$(option).attr('value')}`,
                method: 'GET',
            });
            responses.push(this.requestManager.schedule(newRequest, REQUEST_RETRIES));
        }
        (await Promise.all(responses)).forEach((newResponse) => {
            $ = this.cheerio.load(newResponse.data);
            const embeddedChapters = $('div.m-newest2 > ul.ul-list5 > li').toArray();
            for (let embeddedChapter of embeddedChapters) {
                const link = $('a', embeddedChapter).attr('href') ?? "";
                chapters.push(createChapter({
                    id: link.substring(1, link.indexOf('.')),
                    mangaId: mangaId,
                    chapNum: isNaN(parseInt(link.substring(link.lastIndexOf('-') + 1, link.indexOf('.')))) ? 0 : parseInt(link.substring(link.lastIndexOf('-') + 1, link.indexOf('.'))),
                    langCode: paperback_extensions_common_1.LanguageCode.ENGLISH,
                    name: $('a', embeddedChapter).text()
                }));
            }
        });
        return chapters;
    }
    async getChapterDetails(mangaId, chapterId) {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${chapterId}.html`,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const pages = [];
        const textSegments = [];
        const chapterText = $('div.txt > p').toArray();
        for (let chapterTextSeg of chapterText) {
            textSegments.push((0, FreeWebNovelResponseInterceptor_1.decodeHTMLEntity)($(chapterTextSeg).text()));
        }
        const text = textSegments.join('\n');
        const lines = Math.ceil((0, FreeWebNovelResponseInterceptor_1.spliterate)(text.replace(/[^\x00-\x7F]/g, ""), (await getImageWidth(this.stateManager)) - (await getHorizontalPadding(this.stateManager)) * 2, `${(await getFont(this.stateManager)).toLowerCase().replace(/ /g, "")}${await getFontSize(this.stateManager)}`).split.length / (await getLinesPerPage(this.stateManager)));
        for (let i = 1; i <= lines; i++) {
            pages.push(`${WEBSITE_URL}/${chapterId}.html?ttiparse&ttipage=${i}&ttisettings=${encodeURIComponent(await getSettingsString(this.stateManager))}`);
        }
        return createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
            longStrip: false
        });
    }
    async getSearchResults(query, metadata) {
        if (!query.title || query.title.length < 3)
            return createPagedResults({ results: [] });
        const request = createRequestObject({
            url: `${WEBSITE_URL}/search/${query.title === undefined ? "" : `?searchkey=${encodeURIComponent(query.title)}`}`,
            method: 'POST',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const htmlResults = $('div.ss-custom > div').toArray();
        const results = [];
        for (let htmlResult of htmlResults) {
            const a = $('div.pic > a', htmlResult);
            if ($(a).attr('href') !== undefined) {
                results.push(createMangaTile({
                    id: $(a).attr('href')?.substring(1).split('.')[0] ?? "",
                    title: createIconText({ text: $('img', a).attr('title') ?? "" }),
                    image: $('img', a).attr('src') ?? ""
                }));
            }
        }
        return createPagedResults({ results: results });
    }
    async getHomePageSections(sectionCallback) {
        const sections = [
            createHomeSection({
                id: 'latest-release-novel',
                title: 'Recently Updated Novels',
                view_more: true,
            }),
            createHomeSection({
                id: 'most-popular-novel',
                title: 'Most Popular Novels',
                view_more: true,
            })
        ];
        for (let section of sections) {
            const request = createRequestObject({
                url: `${WEBSITE_URL}/${section.id}/`,
                method: 'GET'
            });
            const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
            const $ = this.cheerio.load(response.data);
            sectionCallback(section);
            const htmlResults = $('div.ss-custom > div').toArray();
            const results = [];
            for (let htmlResult of htmlResults) {
                const a = $('div.pic > a', htmlResult);
                results.push(createMangaTile({
                    id: $(a).attr('href')?.substring(1).split('.')[0] ?? "",
                    title: createIconText({ text: $('img', a).attr('title') ?? "" }),
                    image: $('img', a).attr('src') ?? ""
                }));
            }
            section.items = results;
            sectionCallback(section);
        }
    }
    async getViewMoreItems(homepageSectionId, metadata) {
        const page = metadata?.page ?? 1;
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${homepageSectionId}/${page}/`,
            method: 'GET'
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const lastPage = parseInt($('div.pages > ul > li').children('a').last().text()) === page;
        const htmlResults = $('div.ss-custom > div').toArray();
        const results = [];
        for (let htmlResult of htmlResults) {
            const a = $('div.pic > a', htmlResult);
            results.push(createMangaTile({
                id: $(a).attr('href')?.substring(1).split('.')[0] ?? "",
                title: createIconText({ text: $('img', a).attr('title') ?? "" }),
                image: $('img', a).attr('src') ?? ""
            }));
        }
        return createPagedResults({
            results: results,
            metadata: lastPage ? undefined : { page: page + 1 }
        });
    }
    getMangaShareUrl(mangaId) {
        return `${WEBSITE_URL}/${mangaId}.html`;
    }
}
exports.FreeWebNovel = FreeWebNovel;
exports.FreeWebNovelInfo = {
    version: '2.0.2',
    name: 'FreeWebNovel',
    icon: 'icon.jpg',
    author: 'JimIsWayTooEpic',
    authorWebsite: 'https://phiefferj24.github.io/paperback-sources-lightnovels/master/',
    description: 'EXPERIMENTAL Source for FreeWebNovel. Created by JimIsWayTooEpic.\n\nWARNING: If you increase the image width, it will take longer to load.',
    contentRating: paperback_extensions_common_1.ContentRating.ADULT,
    websiteBaseURL: WEBSITE_URL,
    language: "English",
    sourceTags: [
        {
            text: "Light Novel",
            type: paperback_extensions_common_1.TagType.BLUE
        },
        {
            text: "Experimental",
            type: paperback_extensions_common_1.TagType.YELLOW
        }
    ]
};
async function getTextColor(stateManager) {
    return await stateManager.retrieve('text_color') ?? 'Black';
}
async function getBackgroundColor(stateManager) {
    return await stateManager.retrieve('background_color') ?? 'White';
}
async function getFontSize(stateManager) {
    return await stateManager.retrieve('font_size') ?? 18;
}
async function getFont(stateManager) {
    return await stateManager.retrieve('font') ?? 'San Francisco';
}
async function getHorizontalPadding(stateManager) {
    return await stateManager.retrieve('horizontal_padding') ?? 20;
}
async function getVerticalPadding(stateManager) {
    return await stateManager.retrieve('vertical_padding') ?? 20;
}
async function getImageWidth(stateManager) {
    return await stateManager.retrieve('image_width') ?? 800;
}
async function getLinesPerPage(stateManager) {
    return await stateManager.retrieve('lines_per_page') ?? 60;
}
async function getSettingsString(stateManager) {
    return `${await getTextColor(stateManager)},${await getBackgroundColor(stateManager)},${await getFontSize(stateManager)},${await getFont(stateManager)},${await getHorizontalPadding(stateManager)},${await getVerticalPadding(stateManager)},${await getImageWidth(stateManager)},${await getLinesPerPage(stateManager)}`;
}
async function styleSettings(stateManager) {
    return Promise.resolve(createSection({
        id: 'main',
        header: 'Source Settings',
        rows: async () => [
            createNavigationButton({
                label: 'Reader Style',
                value: '',
                id: 'style',
                form: createForm({
                    sections: async () => {
                        return [
                            createSection({
                                id: '',
                                rows: async () => {
                                    return [
                                        createSelect({
                                            label: 'Text Color',
                                            options: SETTINGS.textColor,
                                            displayLabel: option => { return option; },
                                            value: [await getTextColor(stateManager)],
                                            id: 'text_color',
                                            allowsMultiselect: false
                                        }),
                                        createSelect({
                                            label: 'Background Color',
                                            options: SETTINGS.backgroundColor,
                                            displayLabel: option => { return option; },
                                            value: [await getBackgroundColor(stateManager)],
                                            id: 'background_color',
                                            allowsMultiselect: false
                                        }),
                                        createSelect({
                                            label: 'Font',
                                            options: SETTINGS.font,
                                            displayLabel: option => { return option; },
                                            value: [await getFont(stateManager)],
                                            id: 'font',
                                            allowsMultiselect: false
                                        }),
                                        createSelect({
                                            label: 'Font Size',
                                            options: SETTINGS.fontSize,
                                            displayLabel: option => { return option; },
                                            value: [(await getFontSize(stateManager)).toString()],
                                            id: 'font_size',
                                            allowsMultiselect: false
                                        }),
                                        createStepper({
                                            label: 'Horizontal Padding',
                                            value: await getHorizontalPadding(stateManager),
                                            id: 'horizontal_padding',
                                            min: 0,
                                            max: 100,
                                            step: 5
                                        }),
                                        createStepper({
                                            label: 'Vertical Padding',
                                            value: await getVerticalPadding(stateManager),
                                            id: 'vertical_padding',
                                            min: 0,
                                            max: 100,
                                            step: 5
                                        }),
                                        createStepper({
                                            label: 'Image Width',
                                            value: await getImageWidth(stateManager),
                                            id: 'image_width',
                                            min: 800,
                                            max: 1600,
                                            step: 50
                                        }),
                                        createStepper({
                                            label: 'Lines Per Page',
                                            value: await getLinesPerPage(stateManager),
                                            id: 'lines_per_page',
                                            min: 1,
                                            max: 100,
                                            step: 1
                                        })
                                    ];
                                }
                            })
                        ];
                    },
                    onSubmit: async (values) => {
                        return Promise.all([
                            stateManager.store('text_color', values.text_color[0]),
                            stateManager.store('background_color', values.background_color[0]),
                            stateManager.store('font_size', values.font_size[0]),
                            stateManager.store('font', values.font[0]),
                            stateManager.store('horizontal_padding', values.horizontal_padding),
                            stateManager.store('vertical_padding', values.vertical_padding),
                            stateManager.store('image_width', values.image_width),
                            stateManager.store('lines_per_page', values.lines_per_page)
                        ]).then();
                    },
                    validate: async (values) => {
                        return true;
                    }
                })
            })
        ]
    }));
}
