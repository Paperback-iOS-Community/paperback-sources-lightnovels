"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LightNovelReaderInfo = exports.LightNovelReader = void 0;
const paperback_extensions_common_1 = require("paperback-extensions-common");
const LightNovelReaderResponseInterceptor_1 = require("./LightNovelReaderResponseInterceptor");
const WEBSITE_URL = "https://lightnovelreader.org";
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
class LightNovelReader extends paperback_extensions_common_1.Source {
    constructor() {
        super(...arguments);
        this.requestManager = createRequestManager({
            requestsPerSecond: 10,
            requestTimeout: 10000,
            interceptor: {
                interceptRequest: async (request) => { return request; },
                interceptResponse: async (response) => {
                    return (0, LightNovelReaderResponseInterceptor_1.interceptResponse)(response, this.cheerio, {
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
            url: `${WEBSITE_URL}/${mangaId}`,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const titles = [$('div.cm-breadcrumb > ul').children().last().text()];
        const descriptionSections = $('div.empty-box > p').toArray();
        let description = "";
        for (const descriptionSection of descriptionSections) {
            description += `${(0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($(descriptionSection).text())}\n`;
        }
        const details = $('div.novels-detail');
        let status = paperback_extensions_common_1.MangaStatus.UNKNOWN;
        let author = undefined;
        let artist = undefined;
        const tags = [];
        for (let object of $('div.novels-detail-right > ul', details).children().toArray()) {
            switch ($('div.novels-detail-right-in-left', object).text()) {
                case "Alternative Names:":
                    titles.push($('div.novels-detail-right-in-right', object).text());
                    break;
                case "Status:":
                    status = $('div.novels-detail-right-in-right', object).text() === "Ongoing" ? paperback_extensions_common_1.MangaStatus.ONGOING : paperback_extensions_common_1.MangaStatus.COMPLETED;
                    break;
                case "Genres":
                    for (let tag of $('div.novels-detail-right-in-right', object).children().toArray()) {
                        tags.push(createTag({
                            id: $(tag).text().toLowerCase(),
                            label: $(tag).text()
                        }));
                    }
                    break;
                case "Author(s):":
                    author = $('div.novels-detail-right-in-right', object).text();
                    break;
                case "Artist(s):":
                    artist = $('div.novels-detail-right-in-right', object).text();
                    break;
            }
        }
        return createManga({
            id: mangaId,
            titles: titles,
            image: $('div.novels-detail-left > img', details).attr('src') ?? "",
            status: status,
            author: author,
            artist: artist,
            tags: tags.length === 0 ? undefined : [createTagSection({ id: 'genres', label: 'Genres', tags: tags })],
            desc: description
        });
    }
    async getChapters(mangaId) {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${mangaId}`,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        let $ = this.cheerio.load(response.data);
        const chapters = [];
        let volumes = $('div.novels-detail-chapters').toArray();
        let volumeOn = 1;
        for (let volume of volumes) {
            volumeOn = parseInt($(volume).attr('id')?.split("-").pop() ?? "1");
            const chapterObjects = $('ul', volume).children().toArray();
            for (let chapter of chapterObjects) {
                const chapterData = $('a', chapter);
                const chapterName = chapterData.text();
                chapters.push(createChapter({
                    id: `${$(chapterData).attr('href')?.split("/").pop()}?paperbackVolume=${volumeOn}` ?? "",
                    mangaId: mangaId,
                    chapNum: isNaN(parseFloat(chapterName.substring(chapterName.indexOf("CH") + 3) ?? "0")) ? 0 : parseFloat(chapterName.substring(chapterName.indexOf("CH") + 3) ?? "0"),
                    langCode: paperback_extensions_common_1.LanguageCode.ENGLISH,
                    volume: volumeOn
                }));
            }
        }
        return chapters;
    }
    async getChapterDetails(mangaId, chapterId) {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${mangaId}/${chapterId}`,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const pages = [];
        const textSegments = [];
        const chapterText = $('div#chapterText > p').toArray(); //.splice(0, $('div#chapterText > p').toArray().length-2)
        for (let chapterTextSeg of chapterText) {
            if (!$(chapterTextSeg).hasClass("display-hide"))
                textSegments.push((0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($(chapterTextSeg).text()));
        }
        const text = textSegments.join('\n\n');
        const lines = Math.ceil((0, LightNovelReaderResponseInterceptor_1.spliterate)(text.replace(/[^\x00-\x7F]/g, ""), (await getImageWidth(this.stateManager)) - (await getHorizontalPadding(this.stateManager)) * 2, `${(await getFont(this.stateManager)).toLowerCase().replace(/ /g, "")}${await getFontSize(this.stateManager)}`).split.length / (await getLinesPerPage(this.stateManager)));
        for (let i = 1; i <= lines; i++) {
            pages.push(`${WEBSITE_URL}/${mangaId}/${chapterId}${chapterId.includes("?") ? "&" : "?"}ttiparse&ttipage=${i}&ttisettings=${encodeURIComponent(await getSettingsString(this.stateManager))}`);
        }
        return createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
            longStrip: false
        });
    }
    async getSearchResults(query, metadata) {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/detailed-search`,
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            data: `search=${query.title ?? ""}`
        });
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
        const $ = this.cheerio.load(response.data);
        const htmlResults = $('div.category-items > ul').children().toArray();
        const results = [];
        for (let htmlResult of htmlResults) {
            results.push(createMangaTile({
                id: $('div.category-name > a', htmlResult).attr('href')?.substring(1) ?? "",
                title: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.category-name > a', htmlResult).text()) }),
                image: $('div.category-img > a > img', htmlResult).attr('src') ?? ""
            }));
        }
        return createPagedResults({ results: results });
    }
    async getHomePageSections(sectionCallback) {
        const sections = [
            createHomeSection({
                id: 'latest-updates',
                title: 'Latest Updated Novels',
                view_more: true,
            }),
            createHomeSection({
                id: 'ranking/new',
                title: 'New Novels',
                view_more: true,
            }),
            createHomeSection({
                id: 'ranking/top-rated',
                title: 'Top Rated Novels',
                view_more: true,
            }),
            createHomeSection({
                id: 'ranking/most-viewed',
                title: 'Most Viewed Novels',
                view_more: true,
            }),
        ];
        for (let section of sections) {
            const request = createRequestObject({
                url: `${WEBSITE_URL}/${section.id}/`,
                method: 'GET'
            });
            const response = await this.requestManager.schedule(request, REQUEST_RETRIES);
            const $ = this.cheerio.load(response.data);
            sectionCallback(section);
            const results = [];
            if (section.id.startsWith("ranking")) {
                const htmlResults = $('div.ranking-category > ul').children().toArray();
                for (let htmlResult of htmlResults) {
                    results.push(createMangaTile({
                        id: $('div.category-img > a', htmlResult).attr('href')?.substring(1) ?? "",
                        title: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.category-name > a', htmlResult).text()) }),
                        image: $('div.category-img > a > img', htmlResult).attr('src') ?? ""
                    }));
                }
            }
            else {
                const htmlResults = $('div.latest-updates > ul').children().toArray();
                const addedIds = [];
                for (let htmlResult of htmlResults) {
                    const id = $('div.latest-updates-name > a', htmlResult).attr('href')?.substring(1) ?? "";
                    if (!addedIds.includes(id)) {
                        results.push(createMangaTile({
                            id: id,
                            title: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.latest-updates-name > a', htmlResult).text()) }),
                            subtitleText: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.latest-updates-content', htmlResult).children().first().text()) }),
                            image: $('div.latest-updates-img > a > img', htmlResult).attr('src') ?? ""
                        }));
                        addedIds.push(id);
                    }
                }
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
        const lastPage = parseInt($('nav.cm-pagination').children().last().attr('href')?.split('/').pop() ?? "1");
        const results = [];
        const addedIds = metadata?.addedIds ?? [];
        if (homepageSectionId.startsWith("ranking")) {
            const htmlResults = $('div.ranking-category > ul').children().toArray();
            for (let htmlResult of htmlResults) {
                const id = $('div.category-img > a', htmlResult).attr('href')?.substring(1) ?? "";
                if (!addedIds.includes(id)) {
                    results.push(createMangaTile({
                        id: id,
                        title: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.category-name > a', htmlResult).text()) }),
                        image: $('div.category-img > a > img', htmlResult).attr('src') ?? ""
                    }));
                    addedIds.push(id);
                }
            }
        }
        else {
            const htmlResults = $('div.latest-updates > ul').children().toArray();
            for (let htmlResult of htmlResults) {
                const id = $('div.latest-updates-name > a', htmlResult).attr('href')?.substring(1) ?? "";
                if (!addedIds.includes(id)) {
                    results.push(createMangaTile({
                        id: id,
                        title: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.latest-updates-name > a', htmlResult).text()) }),
                        subtitleText: createIconText({ text: (0, LightNovelReaderResponseInterceptor_1.decodeHTMLEntity)($('div.latest-updates-content', htmlResult).children().first().text()) }),
                        image: $('div.latest-updates-img > a > img', htmlResult).attr('src') ?? ""
                    }));
                    addedIds.push(id);
                }
            }
        }
        return createPagedResults({
            results: results,
            metadata: (lastPage === page) ? undefined : { page: page + 1, addedIds: addedIds }
        });
    }
    getMangaShareUrl(mangaId) {
        return `${WEBSITE_URL}/${mangaId}`;
    }
    getCloudflareBypassRequest() {
        return createRequestObject({
            url: WEBSITE_URL,
            method: "GET"
        });
    }
}
exports.LightNovelReader = LightNovelReader;
exports.LightNovelReaderInfo = {
    version: '1.2.3',
    name: 'LightNovelReader',
    icon: 'icon.png',
    author: 'JimIsWayTooEpic',
    authorWebsite: 'https://phiefferj24.github.io/paperback-sources-lightnovels/master/',
    description: 'EXPERIMENTAL Source for LightNovelReader. Created by JimIsWayTooEpic.\n\nWARNING: If you increase the image width, it will take longer to load.',
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
