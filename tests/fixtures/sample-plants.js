import { setTextLocale } from '../../js/profile.js';

// Hungarian text: compare and sort it the Hungarian way, as an app with locale 'hu' would.
setTextLocale('hu');

// A small made-up table for the tests: common garden plants with invented values, shaped like a real plant
// list (ranges with decimal commas, scale values, flag columns, comma-separated lists, prices as numbers).
// raw: as the Sheets API returns cells with UNFORMATTED_VALUE (numbers as numbers), text: as shown.
export const header = ['Név', 'Latin név', 'Típus', 'Lombozat', 'Magasság (m)', 'Max. magasság (m)', 'Fényigény', 'Mérgező', 'Máj', 'Felhasználás', 'Megjegyzés', 'Ár (Ft)'];

const rows = [
    ['Kislevelű hárs', 'Tilia cordata', 'Fa', 'Lombhullató', '15–20', 20, 'Napos–félárnyék', '', '', 'Szoliter', 'Illatos virág', ''],
    ['Erdei fenyő', 'Pinus sylvestris', 'Fa', 'Örökzöld', '10–15', 15, 'Napos', '', '', 'Szoliter, sövény', 'Vöröses kéreg', ''],
    ['Törpefenyő', 'Pinus mugo', 'Cserje', 'Örökzöld', '1–1,5', 2, 'Napos', '', '', 'Sziklakert, szegély', 'Lassan nő', 2990],
    ['Tiszafa', 'Taxus baccata', 'Cserje', 'Örökzöld', '2–4', 4, 'Félárnyék–árnyék', 'Igen', '', 'Sövény, szoliter', 'Minden része mérgező', 3500],
    ['Fagyal', 'Ligustrum vulgare', 'Cserje', 'Lombhullató', '2–3', 3, 'Napos–félárnyék', 'Igen', '', 'Sövény', 'Gyorsan nő', 990],
    ['Orgona', 'Syringa vulgaris', 'Cserje', 'Lombhullató', '3–4', 4, 'Napos', '', '●', 'Szoliter, cottage', 'Illatos', 2490],
    ['Levendula', 'Lavandula angustifolia', 'Évelő', 'Örökzöld', '0,4–0,6', 0.6, 'Napos', '', '', 'Szegély, sziklakert, cottage', 'Szárazságtűrő', 1290],
    ['Macskamenta', 'Nepeta × faassenii', 'Évelő', 'Télen visszahúzódó', '0,3–0,5', 0.5, 'Napos', '', '●', 'Szegély, cottage', 'Hosszan virágzik', 1190],
    ['Árnyékliliom', 'Hosta sieboldiana', 'Évelő', 'Télen visszahúzódó', '0,5–0,8', 0.8, 'Félárnyék–árnyék', '', '', 'Szegély', 'Csigák kedvelik', ''],
    ['Gyűszűvirág', 'Digitalis purpurea', 'Évelő', 'Télen visszahúzódó', '1–1,5', 1.5, 'Félárnyék', 'Igen', '●', 'Cottage', 'Kétéves', 890],
    ['Kakukkfű', 'Thymus serpyllum', 'Talajtakaró', 'Örökzöld', '0,05–0,1', 0.1, 'Napos', '', '', 'Sziklakert, szegély', 'Lépésálló', 690],
    ['Meténg', 'Vinca minor', 'Talajtakaró', 'Örökzöld', '0,1–0,2', 0.2, 'Félárnyék–árnyék', 'Igen', '', 'Szegély', 'Árnyékban is', 790],
    ['Varjúháj', 'Sedum acre', 'Talajtakaró', 'Örökzöld', '0,05', 0.05, 'Napos', '', '', 'Sziklakert', 'Szárazságtűrő', ''],
    ['Kerti rózsa', "Rosa 'Minta'", 'Cserje', 'Lombhullató', '1–1,5', 1.5, 'Napos', '', '●', 'Cottage, szoliter', '', 2990],
    ['Gyöngyvirág', 'Convallaria majalis', 'Talajtakaró', 'Télen visszahúzódó', '0,15–0,2', 0.2, 'Félárnyék', 'Igen', '●', 'Szegély, cottage', 'Tavasszal virágzik', 590],
    ['Mezei juhar', 'Acer campestre', 'Fa', 'Lombhullató', '8–10', 10, 'Napos–félárnyék', '', '', 'Sövény, szoliter', 'Jól nyírható', '']
];

const shown = value => (typeof value === 'number' ? String(value) : value);
const price = value => (value === '' ? '' : `${String(value).replace(/\B(?=(\d{3})+$)/, ' ')} Ft`);
const priceColumn = header.indexOf('Ár (Ft)');

export const raw = rows;
export const text = rows.map(row => row.map((v, c) => (c === priceColumn ? price(v) : shown(v))));
