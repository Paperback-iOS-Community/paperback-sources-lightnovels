import {
    Chapter,
    ChapterDetails,
    ContentRating,
    HomeSection,
    LanguageCode,
    Manga,
    MangaStatus,
    MangaTile,
    PagedResults,
    Response,
    SearchRequest,
    Source,
    SourceInfo,
    Tag,
    RequestManager,
    TagType,
    SourceStateManager,
    Section,
    FormRow,
    HomeSectionType
} from 'paperback-extensions-common'

import { decodeHTMLEntity, interceptResponse, spliterate } from "./LightNovelReaderResponseInterceptor";

const WEBSITE_URL = "https://lightnovelreader.org"
const REQUEST_RETRIES = 3
const SETTINGS: any = {
    textColor: ["White", "Light Gray", "Brown", "Dark Gray", "Black"],
    backgroundColor: ["White", "Sepia", "Dark Gray", "Black"],
    fontSize: ["18", "24", "30", "36"],
    font: ["Arial", "Georgia", "San Francisco", "Times New Roman"]
}

const COLORS: any = {
    white: 0xFFFFFF,
    light_gray: 0xDDDDDD,
    brown: 0x4C3320,
    sepia: 0xF2E5C9,
    dark_gray: 0x444444,
    black: 0x000000
}

export class LightNovelReader extends Source {
    requestManager: RequestManager = createRequestManager({
        requestsPerSecond: 10,
        requestTimeout: 10000,
        interceptor: {
            interceptRequest: async (request) => {return request},
            interceptResponse: async (response) => {return interceptResponse(response, this.cheerio, {
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
            })}
        }
    })
    stateManager: SourceStateManager = createSourceStateManager({})
    override async getSourceMenu(): Promise<Section> {
        return styleSettings(this.stateManager)
    }
    async getMangaDetails(mangaId: string): Promise<Manga> { 
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${mangaId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        const novel = $('div.container > div > div')
        const titles = [$('div.section-header > div.flex > h1', novel).text()]
        const description = decodeHTMLEntity($('div.text-sm > p', novel).text())
        const details = $('div.flex > div.flex', novel)
        let status = MangaStatus.UNKNOWN
        let author: string | undefined = undefined
        let artist: string | undefined = undefined
        const tags: Tag[] = []
        for(let object of $('dl.text-xs > div', details).toArray()) {
            switch($('dt', object).text()) {
                case "Alternative Names:": titles.push($('dd > a', object).text()); break
                case "Status:": status = $('dd', object).text() === "Ongoing" ? MangaStatus.ONGOING : MangaStatus.COMPLETED; break
                case "Genres":
                    for(let tag of $('dd > a', object).toArray()) {
                        tags.push(createTag({
                            id: $(tag).text().toLowerCase(),
                            label: $(tag).text()
                        }))
                    }
                    break
                case "Author(s):": author = $('dd > a', object).text(); break
                case "Artist(s):": artist = $('dd > a', object).text(); break
            }
        }
        return createManga({
            id: mangaId,
            titles: titles,
            image: $('a > img', details).attr('src') ?? "",
            status: status,
            author: author,
            artist: artist,
            tags: tags.length === 0 ? undefined : [createTagSection({ id: 'genres', label: 'Genres', tags: tags })],
            desc: description
        })
    }
    async getChapters(mangaId: string): Promise<Chapter[]> {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${mangaId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        let $ = this.cheerio.load(response.data)
        const chapters: Chapter[] = []
        let volumes: any[] = []
        if($('div.js-load-chapters') !== undefined) {
            const hiddenId = $('div.js-load-chapters').data('novel-id')
            const newRequest = createRequestObject({
                url: `${WEBSITE_URL}/novel/load-chapters`,
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                data: `novelId=${hiddenId}`
            })
            const newResponse = await this.requestManager.schedule(newRequest, REQUEST_RETRIES)
            $ = this.cheerio.load(newResponse.data)
            volumes = $('div').toArray()
        }
        else {
            volumes = $('div.js-chapter-tab-content > div').toArray()
        }
        let volumeOn = 1
        for(let volume of volumes) {
            if($(volume).attr('x-show') === undefined) continue
            volumeOn = parseInt($(volume).attr('x-show')?.split(" ").pop() ?? "1")
            const chapterRows = $('div.grid', volume).toArray()
            for(let chapterRow of chapterRows) {
                for(let chapter of $('a', chapterRow).toArray()) {
                    chapters.push(createChapter({
                        id: $(chapter).attr('href') ?? "",
                        mangaId: mangaId,
                        chapNum: isNaN(parseInt($('div > span', chapter).text().split(" ")[1] ?? "0")) ? 0 : parseInt($('div > span', chapter).text().split(" ")[1] ?? "0"),
                        langCode: LanguageCode.ENGLISH,
                        volume: volumeOn
                    }))
                }
            }
        }
        return chapters
    }
    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${chapterId}`,
            method: 'GET',
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        const pages: string[] = []
        const textSegments: string[] = []
        const chapterText = $('article > p').toArray()
        for(let chapterTextSeg of chapterText) {
            if($(chapterTextSeg).attr('class') !== "display-hide") textSegments.push(decodeHTMLEntity($(chapterTextSeg).text()))
        }
        const text = textSegments.join('\n\n')
        const lines = Math.ceil(spliterate(text.replace(/[^\x00-\x7F]/g, ""), (await getImageWidth(this.stateManager))-(await getHorizontalPadding(this.stateManager))*2, `${(await getFont(this.stateManager)).toLowerCase().replace(/ /g, "")}${await getFontSize(this.stateManager)}`).split.length/(await getLinesPerPage(this.stateManager)))
        for(let i = 1; i <= lines; i++) {
            pages.push(`${WEBSITE_URL}/${chapterId}?ttiparse&ttipage=${i}&ttisettings=${encodeURIComponent(await getSettingsString(this.stateManager))}`)
        }
        return createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
            longStrip: false
        })
    }
    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const request = createRequestObject({
            url: `${WEBSITE_URL}/detailed-search`,
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            },
            data: `search=${query.title ?? ""}`
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        console.log(`${response.status}: ${response.request.data}`)
        const $ = this.cheerio.load(response.data)
        const htmlResults = $('div.flex-1 > div.mb-4').toArray()
        const results: MangaTile[] = []
        for(let htmlResult of htmlResults) {
            results.push(createMangaTile({
                id: $('div.border-gray-200 > a', htmlResult).attr('href')?.substring(1) ?? "",
                title: createIconText({ text: decodeHTMLEntity($('div.border-gray-200 > a', htmlResult).text())}),
                image: $('div.items-stretch > a > img', htmlResult).attr('src') ?? ""
            }))
        }
        return createPagedResults({ results: results })
    }
    override async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
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
        ]
        for(let section of sections) {
            const request = createRequestObject({
                url: `${WEBSITE_URL}/${section.id}/`,
                method: 'GET'
            })
            const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
            const $ = this.cheerio.load(response.data)
            sectionCallback(section)
            const results: MangaTile[] = []
            if(section.id.startsWith("ranking")) {
                const htmlResults = $('div.flex-1 > div.mb-4').toArray()
                for(let htmlResult of htmlResults) {
                    results.push(createMangaTile({
                        id: $('div.border-gray-200 > a', htmlResult).attr('href')?.substring(1) ?? "",
                        title: createIconText({ text: decodeHTMLEntity($('div.border-gray-200 > a', htmlResult).text()) }),
                        image: $('div.items-stretch > a > img', htmlResult).attr('src') ?? ""
                    }))
                }
            } 
            else {
                const htmlResults = $('div.flex-1 > div.my-4 > div.gap-4').toArray()
                const addedIds: string[] = []
                for(let htmlResult of htmlResults) {
                    const id = $('div.items-center > div.mr-4 > a', htmlResult).attr('href')?.substring(1) ?? ""
                    if(!addedIds.includes(id)) {
                        results.push(createMangaTile({
                            id: id,
                            title: createIconText({ text: decodeHTMLEntity($('div.items-center > div.flex > h2 > a', htmlResult).text()) }),
                            subtitleText: createIconText({ text: decodeHTMLEntity($('a.truncate', htmlResult).text()) }),
                            image: $('div.items-center > div.mr-4 > a > img', htmlResult).attr('src') ?? ""
                        }))
                        addedIds.push(id)
                    }
                }
            }
            section.items = results
            sectionCallback(section)
        }
    }
    override async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const request = createRequestObject({
            url: `${WEBSITE_URL}/${homepageSectionId}/${page}/`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, REQUEST_RETRIES)
        const $ = this.cheerio.load(response.data)
        const lastPage = parseInt($('nav.pagination > a.pagination__item').last().attr('href')?.split('/').pop() ?? "1")
        const results: MangaTile[] = []
        const addedIds: string[] = metadata?.addedIds ?? []
        if(homepageSectionId.startsWith("ranking")) {
            const htmlResults = $('div.flex-1 > div.mb-4').toArray()
            for(let htmlResult of htmlResults) {
                const id = $('div.border-gray-200 > a', htmlResult).attr('href')?.substring(1) ?? ""
                if(!addedIds.includes(id)) {
                    results.push(createMangaTile({
                        id: id,
                        title: createIconText({ text: decodeHTMLEntity($('div.border-gray-200 > a', htmlResult).text()) }),
                        image: $('div.items-stretch > a > img', htmlResult).attr('src') ?? ""
                    }))
                    addedIds.push(id)
                }
            }
        } 
        else {
            const htmlResults = $('div.flex-1 > div.my-4 > div.gap-4').toArray()
            for(let htmlResult of htmlResults) {
                const id = $('div.items-center > div.mr-4 > a', htmlResult).attr('href')?.substring(1) ?? ""
                if(!addedIds.includes(id)) {
                    results.push(createMangaTile({
                        id: id,
                        title: createIconText({ text: decodeHTMLEntity($('div.items-center > div.flex > h2 > a', htmlResult).text()) }),
                        subtitleText: createIconText({ text: decodeHTMLEntity($('a.truncate', htmlResult).text()) }),
                        image: $('div.items-center > div.mr-4 > a > img', htmlResult)?.attr('src') ?? ""
                    }))
                    addedIds.push(id)
                }
            }
        }
        return createPagedResults({
            results: results,
            metadata: (lastPage === page) ? undefined : {page: page + 1, addedIds: addedIds}
        })
    }
    override getMangaShareUrl(mangaId: string): string {
        return `${WEBSITE_URL}/${mangaId}`
    }
}

export const LightNovelReaderInfo: SourceInfo = {
    version: '1.1.1',
    name: 'LightNovelReader',
    icon: 'icon.png',
    author: 'JimIsWayTooEpic',
    authorWebsite: 'https://phiefferj24.github.io/paperback-sources-lightnovels/master/',
    description: 'EXPERIMENTAL Source for LightNovelReader. Created by JimIsWayTooEpic.\n\nWARNING: If you increase the image width, it will take longer to load.',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: WEBSITE_URL,
    language: "English",
    sourceTags: [
        {
            text: "Light Novel",
            type: TagType.BLUE
        },
        {
            text: "Experimental",
            type: TagType.YELLOW
        }
    ]
}

async function getTextColor(stateManager: SourceStateManager): Promise<string> {
    return (await stateManager.retrieve('text_color') as string) ?? 'Black'
}
async function getBackgroundColor(stateManager: SourceStateManager): Promise<string> {
    return (await stateManager.retrieve('background_color') as string) ?? 'White'
}
async function getFontSize(stateManager: SourceStateManager): Promise<number> {
    return (await stateManager.retrieve('font_size') as number) ?? 18
}
async function getFont(stateManager: SourceStateManager): Promise<string> {
    return (await stateManager.retrieve('font') as string) ?? 'San Francisco'
}
async function getHorizontalPadding(stateManager: SourceStateManager): Promise<number> {
    return await stateManager.retrieve('horizontal_padding') as number ?? 20
}
async function getVerticalPadding(stateManager: SourceStateManager): Promise<number> {
    return await stateManager.retrieve('vertical_padding') as number ?? 20
}
async function getImageWidth(stateManager: SourceStateManager): Promise<number> {
    return await stateManager.retrieve('image_width') as number ?? 800
}
async function getLinesPerPage(stateManager: SourceStateManager): Promise<number> {
    return await stateManager.retrieve('lines_per_page') as number ?? 60
}
async function getSettingsString(stateManager: SourceStateManager) {
    return `${await getTextColor(stateManager)},${await getBackgroundColor(stateManager)},${await getFontSize(stateManager)},${await getFont(stateManager)},${await getHorizontalPadding(stateManager)},${await getVerticalPadding(stateManager)},${await getImageWidth(stateManager)},${await getLinesPerPage(stateManager)}`
}

async function styleSettings(stateManager: SourceStateManager): Promise<Section> {
    return Promise.resolve(createSection({
        id: 'main',
        header: 'Source Settings',
        rows: async () => [
            createNavigationButton({
                label: 'Reader Style',
                value: '',
                id: 'style',
                form: createForm({
                    sections: async (): Promise<Section[]> => {
                        return [
                            createSection({
                                id: '',
                                rows: async (): Promise<FormRow[]> => {
                                    return [
                                        createSelect({
                                            label: 'Text Color',
                                            options: SETTINGS.textColor,
                                            displayLabel: option => {return option},
                                            value: [await getTextColor(stateManager)],
                                            id: 'text_color',
                                            allowsMultiselect: false
                                        }),
                                        createSelect({
                                            label: 'Background Color',
                                            options: SETTINGS.backgroundColor,
                                            displayLabel: option => {return option},
                                            value: [await getBackgroundColor(stateManager)],
                                            id: 'background_color',
                                            allowsMultiselect: false
                                        }),
                                        createSelect({
                                            label: 'Font',
                                            options: SETTINGS.font,
                                            displayLabel: option => {return option},
                                            value: [await getFont(stateManager)],
                                            id: 'font',
                                            allowsMultiselect: false
                                        }),
                                        createSelect({
                                            label: 'Font Size',
                                            options: SETTINGS.fontSize,
                                            displayLabel: option => {return option},
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
                                    ]
                                }
                            })
                        ]
                    },
                    onSubmit: async (values: any): Promise<void> => {
                        return Promise.all([
                            stateManager.store('text_color', values.text_color[0]),
                            stateManager.store('background_color', values.background_color[0]),
                            stateManager.store('font_size', values.font_size[0]),
                            stateManager.store('font', values.font[0]),
                            stateManager.store('horizontal_padding', values.horizontal_padding),
                            stateManager.store('vertical_padding', values.vertical_padding),
                            stateManager.store('image_width', values.image_width),
                            stateManager.store('lines_per_page', values.lines_per_page)
                        ]).then()
                    },
                    validate: async (values: any): Promise<boolean> => {
                        return true
                    }
                })
            })
        ]
    }))
}
