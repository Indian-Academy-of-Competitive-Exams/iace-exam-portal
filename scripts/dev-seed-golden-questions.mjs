/**
 * DEV-ONLY: the corpus the exam renderer is judged against — images, tables, inline and display
 * equations, sup/sub and lists, each in English, Hindi and Telugu. Tagged `golden` and prefixed
 * `qg_`, so `--reset` purges the corpus and nothing else. Refuses a DATABASE_URL that is not local.
 * Run: node scripts/dev-seed-golden-questions.mjs [--reset]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';

// --- env: whatever the shell has not already set, taken from .env ---
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const at = line.indexOf('=');
    const key = at > 0 ? line.slice(0, at).trim() : '';
    if (!key || key.startsWith('#') || process.env[key]) continue;
    process.env[key] = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env — rely on the shell */
}

const url = process.env.DATABASE_URL ?? '';
const looksLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|db)[:/]/.test(url);
if (!looksLocal && process.env.FORCE_DEV_SEED !== '1') {
  console.error(
    `Refusing to run: DATABASE_URL does not look local.\n  ${url || '(unset)'}\n  Set FORCE_DEV_SEED=1 to override on a disposable database.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The figures. Drawn here rather than committed, so the corpus is one file and
// the bytes in the bucket are always the ones this script describes.
// ---------------------------------------------------------------------------

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, check]);
}

/** `draw` inks pixels on a white canvas; what comes back is a PNG an `<img>` can fetch. */
function png(width, height, draw) {
  const pixels = Buffer.alloc(width * height * 3, 0xff);
  draw((x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (Math.round(y) * width + Math.round(x)) * 3;
    pixels[at] = 0x1b;
    pixels[at + 1] = 0x22;
    pixels[at + 2] = 0x2f;
  });

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    pixels.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const stroke = (ink) => (x1, y1, x2, y2) => {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let step = 0; step <= steps; step += 1) {
    const x = x1 + ((x2 - x1) * step) / steps;
    const y = y1 + ((y2 - y1) * step) / steps;
    ink(x, y);
    ink(x + 1, y);
  }
};

const triangle = () =>
  png(320, 200, (ink) => {
    const line = stroke(ink);
    line(40, 160, 280, 160);
    line(40, 160, 40, 30);
    line(40, 30, 280, 160);
    line(40, 140, 60, 140);
    line(60, 140, 60, 160);
  });

/** Wider than any panel it lands in, which is the only way to see `max-w-full` working. */
const chart = () =>
  png(1200, 320, (ink) => {
    const line = stroke(ink);
    line(60, 280, 1140, 280);
    line(60, 280, 60, 30);
    const bars = [90, 170, 130, 240, 200, 60, 150];
    bars.forEach((height, index) => {
      const left = 110 + index * 145;
      line(left, 280 - height, left + 90, 280 - height);
      line(left, 280 - height, left, 280);
      line(left + 90, 280 - height, left + 90, 280);
    });
  });

const FIGURES = [
  ['golden/right-triangle.png', triangle()],
  ['golden/bar-chart.png', chart()],
];

const publicBase = (process.env.S3_PUBLIC_URL ?? 'http://localhost:9000/iace-local').replace(
  /\/$/,
  '',
);
const urlOf = (key) => `${publicBase}/${key}`;

async function putFigures() {
  try {
    const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
    });
    for (const [key, body] of FIGURES) {
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET ?? 'iace-local',
          Key: key,
          Body: body,
          ContentType: 'image/png',
        }),
      );
    }
    client.destroy();
    const probe = await fetch(urlOf(FIGURES[0][0])).catch(() => null);
    if (!probe?.ok) {
      console.warn(
        `  Figures uploaded but not readable without a signature. Open the bucket:\n    docker compose run --rm minio-init  (or: mc anonymous set download local/${process.env.S3_BUCKET})`,
      );
    }
    return true;
  } catch (error) {
    console.warn(`  Could not upload the figures (${error.message}). The questions still seed.`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// The content. Fragments are shared across languages — a paper shows one figure
// and one table however many languages it is sat in; only the words differ.
// ---------------------------------------------------------------------------

const attr = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const p = (text) => `<p>${text}</p>`;
const img = (key, alt) => `<p><img src="${urlOf(key)}" alt="${attr(alt)}"></p>`;
const inline = (latex) => `<span data-type="inline-math" data-latex="${attr(latex)}"></span>`;
const display = (latex) => `<div data-type="block-math" data-latex="${attr(latex)}"></div>`;

const TRIANGLE = 'golden/right-triangle.png';
const CHART = 'golden/bar-chart.png';

const SALES_TABLE = `<table><thead><tr><th>Year</th><th>Units</th><th>Revenue</th></tr></thead><tbody><tr><td>2021</td><td>1,240</td><td>₹ 18.6 L</td></tr><tr><td>2022</td><td>1,860</td><td>₹ 29.7 L</td></tr><tr><td>2023</td><td>2,790</td><td>₹ 47.4 L</td></tr><tr><td>2024</td><td>3,348</td><td>₹ 60.3 L</td></tr></tbody></table>`;

const WIDE_TABLE = `<table><thead><tr><th>State</th><th>2018</th><th>2019</th><th>2020</th><th>2021</th><th>2022</th><th>2023</th><th>2024</th><th>Change</th></tr></thead><tbody><tr><td>Andhra Pradesh</td><td>62</td><td>64</td><td>61</td><td>68</td><td>71</td><td>74</td><td>77</td><td>+15</td></tr><tr><td>Telangana</td><td>58</td><td>61</td><td>60</td><td>66</td><td>70</td><td>73</td><td>76</td><td>+18</td></tr><tr><td>Karnataka</td><td>66</td><td>67</td><td>65</td><td>70</td><td>72</td><td>75</td><td>78</td><td>+12</td></tr></tbody></table>`;

const STEPS = `<ol><li>Square both sides</li><li>Collect like terms</li><li>Factorise</li></ol>`;
const RULES = `<ul><li>Every gas is measured at STP</li><li>Masses are in grams</li><li>Answers are to two decimals</li></ul>`;

const PASSAGE = {
  en: p(
    'The clerk who joined the district office in 1974 remembers a room of ledgers, each entry copied twice and initialled in the margin. Nothing was ever thrown away, and nothing could be found. When the office was computerised in 2003 the ledgers moved to a store room and the same clerks, now supervisors, learned to type. What surprised them was not the speed but the silence: a query that had taken a fortnight of letters was answered before the tea arrived. The older staff distrusted it, saying a record you cannot hold is a record you cannot defend, and for two years both systems ran side by side. The paper won every argument and lost every race. By 2006 the ledgers were consulted only when the network failed, which it did often enough that nobody threw them away.',
  ),
  hi: p(
    '1974 में जिला कार्यालय में भर्ती हुए लिपिक को आज भी बहीखातों से भरा वह कमरा याद है, जहाँ हर प्रविष्टि दो बार लिखी जाती और हाशिये पर हस्ताक्षर होते थे। कुछ भी फेंका नहीं जाता था, और कुछ भी मिलता नहीं था। 2003 में जब कार्यालय कंप्यूटरीकृत हुआ, बहीखाते भंडार कक्ष में चले गए और वही लिपिक, जो अब पर्यवेक्षक थे, टाइप करना सीखने लगे। उन्हें गति ने नहीं, चुप्पी ने चौंकाया: जिस पूछताछ में पखवाड़े भर पत्राचार लगता था, उसका उत्तर चाय आने से पहले मिल जाता था। पुराने कर्मचारियों को भरोसा नहीं हुआ — जो अभिलेख हाथ में न हो, उसकी रक्षा कैसे होगी — और दो वर्ष तक दोनों व्यवस्थाएँ साथ चलीं। कागज़ हर बहस जीतता रहा और हर दौड़ हारता रहा।',
  ),
  te: p(
    '1974లో జిల్లా కార్యాలయంలో చేరిన గుమాస్తాకు ఇప్పటికీ ఆ లెడ్జర్ల గది గుర్తుంది — ప్రతి నమోదునూ రెండుసార్లు రాసి, అంచున సంతకం చేసేవారు. ఏదీ పారవేయలేదు, ఏదీ దొరకలేదు. 2003లో కార్యాలయం కంప్యూటరీకరణ జరిగినప్పుడు లెడ్జర్లు స్టోర్ గదికి వెళ్ళాయి, అప్పటికి పర్యవేక్షకులైన అదే గుమాస్తాలు టైపు నేర్చుకున్నారు. వారిని ఆశ్చర్యపరిచింది వేగం కాదు, నిశ్శబ్దం: పదిహేను రోజుల ఉత్తరప్రత్యుత్తరాలు పట్టే ప్రశ్నకు టీ వచ్చేలోపే జవాబు వచ్చేది. పాత సిబ్బంది నమ్మలేదు — చేతిలో పట్టుకోలేని రికార్డును కాపాడటం ఎలా అని — రెండేళ్ళు రెండు వ్యవస్థలూ కలిసి నడిచాయి. కాగితం ప్రతి వాదననూ గెలిచింది, ప్రతి పందెంలోనూ ఓడింది.',
  ),
};

/** One option's text: a bare string is the same in every language, which a number usually is. */
const say = (text, lang) => (typeof text === 'string' ? text : text[lang]);

const CORPUS = [
  {
    key: 'triangle_area',
    subject: 'QUANTITATIVE_APTITUDE',
    difficulty: 'MEDIUM',
    tags: ['image', 'math'],
    correct: 1,
    stem: {
      en: `${p('The figure shows a right triangle with base 24 cm and height 13 cm.')}${img(TRIANGLE, 'Right triangle')}${p(`Using ${inline('A = \\tfrac{1}{2}bh')}, find its area.`)}`,
      hi: `${p('चित्र में आधार 24 सेमी और ऊँचाई 13 सेमी वाला समकोण त्रिभुज दिखाया गया है।')}${img(TRIANGLE, 'समकोण त्रिभुज')}${p(`${inline('A = \\tfrac{1}{2}bh')} का प्रयोग कर क्षेत्रफल ज्ञात कीजिए।`)}`,
      te: `${p('చిత్రంలో భూమి 24 సెం.మీ., ఎత్తు 13 సెం.మీ. ఉన్న లంబకోణ త్రిభుజం ఉంది.')}${img(TRIANGLE, 'లంబకోణ త్రిభుజం')}${p(`${inline('A = \\tfrac{1}{2}bh')} ఉపయోగించి వైశాల్యం కనుక్కోండి.`)}`,
    },
    options: ['156 cm²', '312 cm²', '78 cm²', '169 cm²'],
  },
  {
    key: 'sales_growth',
    subject: 'QUANTITATIVE_APTITUDE',
    difficulty: 'LOW',
    tags: ['table', 'math'],
    correct: 2,
    stem: {
      en: `${p('The table records four years of sales.')}${SALES_TABLE}${p(`By what percentage did units grow from 2021 to 2022? Use ${inline('\\frac{new - old}{old} \\times 100')}.`)}`,
      hi: `${p('तालिका में चार वर्षों की बिक्री दर्ज है।')}${SALES_TABLE}${p(`2021 से 2022 तक इकाइयाँ कितने प्रतिशत बढ़ीं? ${inline('\\frac{new - old}{old} \\times 100')} का प्रयोग कीजिए।`)}`,
      te: `${p('పట్టికలో నాలుగు సంవత్సరాల అమ్మకాలు ఉన్నాయి.')}${SALES_TABLE}${p(`2021 నుండి 2022 వరకు యూనిట్లు ఎంత శాతం పెరిగాయి? ${inline('\\frac{new - old}{old} \\times 100')} వాడండి.`)}`,
    },
    options: ['40%', '50%', '62%', '86%'],
  },
  {
    key: 'definite_integral',
    subject: 'QUANTITATIVE_APTITUDE',
    difficulty: 'HIGH',
    tags: ['math', 'display-math'],
    correct: 1,
    stem: {
      en: `${p('Evaluate the integral below.')}${display('\\int_{0}^{1} \\left(3x^{2} + 2x\\right)\\,dx')}${p(`The antiderivative is ${inline('x^{3} + x^{2}')}.`)}${STEPS}`,
      hi: `${p('नीचे दिए समाकल का मान ज्ञात कीजिए।')}${display('\\int_{0}^{1} \\left(3x^{2} + 2x\\right)\\,dx')}${p(`प्रतिअवकलज ${inline('x^{3} + x^{2}')} है।`)}${STEPS}`,
      te: `${p('కింది సమాకలనం విలువ కనుక్కోండి.')}${display('\\int_{0}^{1} \\left(3x^{2} + 2x\\right)\\,dx')}${p(`ప్రతిఅవకలజం ${inline('x^{3} + x^{2}')}.`)}${STEPS}`,
    },
    options: ['2', '3', '1', '5'],
  },
  {
    key: 'everything_at_once',
    subject: 'QUANTITATIVE_APTITUDE',
    difficulty: 'HIGH',
    tags: ['image', 'table', 'math', 'display-math'],
    correct: 3,
    stem: {
      en: `${p('The chart and the table describe the same four years.')}${img(CHART, 'Bar chart of yearly units')}${SALES_TABLE}${p(`Revenue per unit is ${inline('r = \\frac{R}{U}')}, and across the whole period`)}${display('\\bar{r} = \\frac{\\sum R_i}{\\sum U_i}')}${p('Which year had the highest revenue per unit?')}`,
      hi: `${p('आरेख और तालिका उन्हीं चार वर्षों का वर्णन करते हैं।')}${img(CHART, 'वार्षिक इकाइयों का दंड आरेख')}${SALES_TABLE}${p(`प्रति इकाई राजस्व ${inline('r = \\frac{R}{U}')} है, और पूरी अवधि के लिए`)}${display('\\bar{r} = \\frac{\\sum R_i}{\\sum U_i}')}${p('किस वर्ष प्रति इकाई राजस्व सबसे अधिक था?')}`,
      te: `${p('చార్టు మరియు పట్టిక ఒకే నాలుగు సంవత్సరాలను చూపుతాయి.')}${img(CHART, 'సంవత్సరాల యూనిట్ల బార్ చార్ట్')}${SALES_TABLE}${p(`యూనిట్‌కు ఆదాయం ${inline('r = \\frac{R}{U}')}, మొత్తం కాలానికి`)}${display('\\bar{r} = \\frac{\\sum R_i}{\\sum U_i}')}${p('ఏ సంవత్సరంలో యూనిట్‌కు ఆదాయం అత్యధికం?')}`,
    },
    options: ['2021', '2022', '2023', '2024'],
  },
  {
    key: 'chemical_notation',
    subject: 'GENERAL_AWARENESS',
    difficulty: 'LOW',
    tags: ['supsub'],
    correct: 0,
    stem: {
      en: `${p('Sulphuric acid is written H<sub>2</sub>SO<sub>4</sub>, and a squared length as x<sup>2</sup>.')}${RULES}${p('Which formula names the acid above?')}`,
      hi: `${p('गंधकाम्ल को H<sub>2</sub>SO<sub>4</sub> लिखा जाता है, और वर्ग को x<sup>2</sup>।')}${RULES}${p('ऊपर दिया गया अम्ल कौन-सा है?')}`,
      te: `${p('సల్ఫ్యూరిక్ ఆమ్లాన్ని H<sub>2</sub>SO<sub>4</sub> అని, వర్గాన్ని x<sup>2</sup> అని రాస్తారు.')}${RULES}${p('పైన ఇచ్చిన ఆమ్లం ఏది?')}`,
    },
    options: ['H₂SO₄', 'HNO₃', 'HCl', 'H₃PO₄'],
  },
  {
    key: 'wide_table',
    subject: 'GENERAL_AWARENESS',
    difficulty: 'MEDIUM',
    tags: ['table', 'wide'],
    correct: 1,
    stem: {
      en: `${p('The table gives literacy figures for seven years.')}${WIDE_TABLE}${p('Which state gained the most over the period?')}`,
      hi: `${p('तालिका में सात वर्षों के साक्षरता आँकड़े दिए गए हैं।')}${WIDE_TABLE}${p('इस अवधि में किस राज्य ने सबसे अधिक वृद्धि की?')}`,
      te: `${p('పట్టికలో ఏడు సంవత్సరాల అక్షరాస్యత గణాంకాలు ఉన్నాయి.')}${WIDE_TABLE}${p('ఈ కాలంలో ఏ రాష్ట్రం అత్యధికంగా మెరుగుపడింది?')}`,
    },
    options: [
      { en: 'Andhra Pradesh', hi: 'आंध्र प्रदेश', te: 'ఆంధ్రప్రదేశ్' },
      { en: 'Telangana', hi: 'तेलंगाना', te: 'తెలంగాణ' },
      { en: 'Karnataka', hi: 'कर्नाटक', te: 'కర్ణాటక' },
      { en: 'All gained equally', hi: 'सभी की वृद्धि समान', te: 'అన్నీ సమానంగా' },
    ],
  },
  {
    key: 'figure_series',
    subject: 'REASONING',
    difficulty: 'MEDIUM',
    tags: ['image', 'math'],
    correct: 2,
    stem: {
      en: `${p('Each figure below adds one row to the one before it.')}${img(TRIANGLE, 'Triangle of dots')}${p(`The nth figure holds ${inline('\\frac{n(n+1)}{2}')} dots. How many are in the 9th?`)}`,
      hi: `${p('नीचे प्रत्येक आकृति पिछली आकृति में एक पंक्ति जोड़ती है।')}${img(TRIANGLE, 'बिंदुओं का त्रिभुज')}${p(`n-वीं आकृति में ${inline('\\frac{n(n+1)}{2}')} बिंदु हैं। नौवीं में कितने होंगे?`)}`,
      te: `${p('కింది ప్రతి ఆకృతి ముందుదానికి ఒక వరుసను కలుపుతుంది.')}${img(TRIANGLE, 'బిందువుల త్రిభుజం')}${p(`n-వ ఆకృతిలో ${inline('\\frac{n(n+1)}{2}')} బిందువులు. తొమ్మిదవ దానిలో ఎన్ని?`)}`,
    },
    options: ['36', '40', '45', '55'],
  },
  {
    key: 'long_stem',
    subject: 'REASONING',
    difficulty: 'HIGH',
    tags: ['long'],
    correct: 3,
    stem: {
      en: `${p('Six candidates — P, Q, R, S, T and U — sit in one row facing north. P is third from the left. Q sits immediately right of P and immediately left of R. S is at one end and is not adjacent to T. U is not at either end and sits somewhere left of P. Every seat is taken and no two candidates share one.')}${RULES}${p('Who sits at the right end?')}`,
      hi: `${p('छह अभ्यर्थी — P, Q, R, S, T और U — एक पंक्ति में उत्तर की ओर मुख करके बैठे हैं। P बाएँ से तीसरा है। Q, P के ठीक दाएँ और R के ठीक बाएँ बैठा है। S किसी एक छोर पर है और T के निकट नहीं है। U किसी छोर पर नहीं है और P के बाईं ओर कहीं बैठा है।')}${RULES}${p('दाएँ छोर पर कौन बैठा है?')}`,
      te: `${p('ఆరుగురు అభ్యర్థులు — P, Q, R, S, T మరియు U — ఉత్తరం వైపు చూస్తూ ఒకే వరుసలో కూర్చున్నారు. P ఎడమ నుండి మూడవవాడు. Q, P కి కుడివైపున, R కి ఎడమవైపున ఉన్నాడు. S ఒక చివర ఉన్నాడు, T పక్కన లేడు. U ఏ చివరా లేడు, P కి ఎడమవైపు ఎక్కడో ఉన్నాడు.')}${RULES}${p('కుడి చివర ఎవరు కూర్చున్నారు?')}`,
    },
    options: ['P', 'Q', 'T', 'S'],
  },
  {
    key: 'broken_equation',
    subject: 'QUANTITATIVE_APTITUDE',
    difficulty: 'LOW',
    tags: ['math', 'malformed'],
    correct: 0,
    stem: {
      en: `${p(`An equation the author left half-typed: ${inline('\\frac{1}{')} — the paper must still be readable around it.`)}${p('What is 12 × 12?')}`,
      hi: `${p(`लेखक द्वारा अधूरा छोड़ा गया समीकरण: ${inline('\\frac{1}{')} — इसके बावजूद प्रश्न पढ़ा जाना चाहिए।`)}${p('12 × 12 कितना है?')}`,
      te: `${p(`రచయిత సగంలో వదిలిన సమీకరణం: ${inline('\\frac{1}{')} — అయినా ప్రశ్న చదవగలగాలి.`)}${p('12 × 12 ఎంత?')}`,
    },
    options: ['144', '124', '132', '156'],
  },
  {
    key: 'hostile_markup',
    subject: 'GENERAL_AWARENESS',
    difficulty: 'LOW',
    tags: ['hostile'],
    correct: 1,
    stem: {
      en: `${p('This question carries markup no bank should execute.')}<script>window.__golden = 'executed';</script><img src="x" onerror="window.__golden = 'executed'"><div style="position:fixed;inset:0;background:red">A div that would cover the paper</div>${p('What is the capital of Telangana?')}`,
      hi: `${p('इस प्रश्न में ऐसा मार्कअप है जो कभी नहीं चलना चाहिए।')}<script>window.__golden = 'executed';</script>${p('तेलंगाना की राजधानी क्या है?')}`,
      te: `${p('ఈ ప్రశ్నలో ఎప్పటికీ నడవకూడని మార్కప్ ఉంది.')}<script>window.__golden = 'executed';</script>${p('తెలంగాణ రాజధాని ఏది?')}`,
    },
    options: [
      { en: 'Amaravati', hi: 'अमरावती', te: 'అమరావతి' },
      { en: 'Hyderabad', hi: 'हैदराबाद', te: 'హైదరాబాద్' },
      { en: 'Bengaluru', hi: 'बेंगलुरु', te: 'బెంగళూరు' },
      { en: 'Chennai', hi: 'चेन्नई', te: 'చెన్నై' },
    ],
  },
  {
    key: 'math_in_options',
    subject: 'QUANTITATIVE_APTITUDE',
    difficulty: 'MEDIUM',
    tags: ['math', 'options'],
    correct: 0,
    stem: {
      en: p(`Which expression equals ${inline('\\sin^{2}\\theta + \\cos^{2}\\theta')}?`),
      hi: p(`${inline('\\sin^{2}\\theta + \\cos^{2}\\theta')} किसके बराबर है?`),
      te: p(`${inline('\\sin^{2}\\theta + \\cos^{2}\\theta')} దేనికి సమానం?`),
    },
    options: [inline('1'), inline('\\tan\\theta'), inline('2\\sin\\theta'), inline('0')],
  },
  {
    key: 'formatted_marks',
    subject: 'GENERAL_AWARENESS',
    difficulty: 'LOW',
    tags: ['marks'],
    correct: 2,
    stem: {
      en: `${p('The Act was passed in <strong>1935</strong>, amended in <em>1947</em> and finally <u>repealed</u> in 1950.')}${p('In which year was it repealed?')}`,
      hi: `${p('अधिनियम <strong>1935</strong> में पारित हुआ, <em>1947</em> में संशोधित हुआ और 1950 में <u>निरस्त</u> कर दिया गया।')}${p('यह किस वर्ष निरस्त हुआ?')}`,
      te: `${p('చట్టం <strong>1935</strong>లో ఆమోదం పొంది, <em>1947</em>లో సవరించబడి, 1950లో <u>రద్దు</u> అయింది.')}${p('ఇది ఏ సంవత్సరంలో రద్దయింది?')}`,
    },
    options: ['1935', '1947', '1950', '1962'],
  },
];

const READING = [
  {
    key: 'rc_what_changed',
    difficulty: 'MEDIUM',
    correct: 1,
    ask: {
      en: 'What surprised the older staff about the new system?',
      hi: 'नई व्यवस्था की कौन-सी बात पुराने कर्मचारियों को चौंका गई?',
      te: 'కొత్త వ్యవస్థలో పాత సిబ్బందిని ఆశ్చర్యపరిచింది ఏమిటి?',
    },
    options: [
      { en: 'Its cost', hi: 'उसकी लागत', te: 'దాని ఖర్చు' },
      { en: 'Its silence', hi: 'उसकी चुप्पी', te: 'దాని నిశ్శబ్దం' },
      { en: 'Its colour', hi: 'उसका रंग', te: 'దాని రంగు' },
      { en: 'Its size', hi: 'उसका आकार', te: 'దాని పరిమాణం' },
    ],
  },
  {
    key: 'rc_year',
    difficulty: 'LOW',
    correct: 2,
    ask: {
      en: 'In which year was the office computerised?',
      hi: 'कार्यालय किस वर्ष कंप्यूटरीकृत हुआ?',
      te: 'కార్యాలయం ఏ సంవత్సరంలో కంప్యూటరీకరణ అయింది?',
    },
    options: ['1974', '1996', '2003', '2006'],
  },
  {
    key: 'rc_inference',
    difficulty: 'HIGH',
    correct: 3,
    ask: {
      en: '"The paper won every argument and lost every race" most nearly means:',
      hi: '"कागज़ हर बहस जीतता रहा और हर दौड़ हारता रहा" का निकटतम अर्थ है:',
      te: '"కాగితం ప్రతి వాదననూ గెలిచింది, ప్రతి పందెంలోనూ ఓడింది" అంటే:',
    },
    options: [
      { en: 'Paper was cheaper', hi: 'कागज़ सस्ता था', te: 'కాగితం చౌక' },
      { en: 'Paper was faster', hi: 'कागज़ तेज़ था', te: 'కాగితం వేగవంతం' },
      {
        en: 'Paper was abandoned at once',
        hi: 'कागज़ तुरंत छोड़ दिया गया',
        te: 'కాగితం వెంటనే వదిలేశారు',
      },
      {
        en: 'Paper was trusted but slow',
        hi: 'कागज़ भरोसेमंद था पर धीमा',
        te: 'కాగితం నమ్మదగినది కానీ నెమ్మది',
      },
    ],
  },
  {
    key: 'rc_why_kept',
    difficulty: 'MEDIUM',
    correct: 0,
    ask: {
      en: 'Why were the ledgers not thrown away after 2006?',
      hi: '2006 के बाद बहीखाते क्यों नहीं फेंके गए?',
      te: '2006 తర్వాత లెడ్జర్లను ఎందుకు పారవేయలేదు?',
    },
    options: [
      {
        en: 'The network kept failing',
        hi: 'नेटवर्क बार-बार बंद होता था',
        te: 'నెట్‌వర్క్ తరచూ ఆగిపోయేది',
      },
      { en: 'A rule forbade it', hi: 'नियम मना करता था', te: 'ఒక నిబంధన అడ్డుకుంది' },
      { en: 'There was no space', hi: 'जगह नहीं थी', te: 'స్థలం లేదు' },
      { en: 'Nobody could read them', hi: 'कोई पढ़ नहीं सकता था', te: 'ఎవరూ చదవలేకపోయారు' },
    ],
  },
];

const LANGS = ['en', 'hi', 'te'];

function versionOf(entry) {
  const content = {};
  for (const lang of LANGS) {
    content[lang] = {
      stem: [{ type: 'TEXT', text: entry.stem[lang] }],
      solution: [{ type: 'TEXT', text: p(say(entry.options[entry.correct], lang)) }],
    };
  }
  const options = entry.options.map((option, index) => ({
    id: `o${index + 1}`,
    position: index + 1,
    isCorrect: index === entry.correct,
    text: Object.fromEntries(
      LANGS.map((lang) => [lang, [{ type: 'TEXT', text: p(say(option, lang)) }]]),
    ),
  }));
  return { content, options };
}

function rowsFor(entry, subjectId) {
  const id = `qg_${entry.key}`;
  const { content, options } = versionOf(entry);
  return {
    question: {
      id,
      questionCode: `QG-${entry.key.toUpperCase().replaceAll('_', '-')}`,
      type: 'SINGLE_MCQ',
      subjectId,
      difficulty: entry.difficulty,
      status: 'ACTIVE',
      // Set in a second pass: the currentVersion FK is immediate, so the version must exist first.
      currentVersionId: null,
      tags: ['golden', ...entry.tags],
      stemHash: null,
      fixedUseCount: 0,
    },
    version: { id: `qvg_${entry.key}`, questionId: id, version: 1, content, options },
  };
}

/** The passage rides on every sub-question: the bank has no passage of its own to hang them off. */
const readingEntries = () =>
  READING.map((entry) => ({
    key: entry.key,
    subject: 'ENGLISH',
    difficulty: entry.difficulty,
    tags: ['reading', 'long'],
    correct: entry.correct,
    options: entry.options,
    stem: Object.fromEntries(LANGS.map((lang) => [lang, `${PASSAGE[lang]}${p(entry.ask[lang])}`])),
  }));

async function main() {
  const reset = process.argv.includes('--reset');
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.question.count({ where: { tags: { has: 'golden' } } });
    if (reset && existing > 0) {
      // Break the circular restrict (Question.currentVersionId <-> QuestionVersion) before deleting.
      await prisma.$executeRawUnsafe(
        `UPDATE "Question" SET "currentVersionId" = NULL WHERE 'golden' = ANY("tags")`,
      );
      await prisma.$transaction([
        prisma.questionVersion.deleteMany({ where: { question: { tags: { has: 'golden' } } } }),
        prisma.question.deleteMany({ where: { tags: { has: 'golden' } } }),
      ]);
      console.log(`Purged ${existing} old golden questions.`);
    } else if (existing > 0) {
      console.log(`A golden corpus exists (${existing} questions). Filling any gaps in it.`);
    }

    const subjects = new Map(
      (await prisma.subject.findMany()).map((subject) => [subject.code, subject.id]),
    );
    const entries = [...CORPUS, ...readingEntries()];
    const missing = [...new Set(entries.map((e) => e.subject))].filter((c) => !subjects.has(c));
    if (missing.length > 0) {
      console.error(`Seed the catalog first — no subject with code ${missing.join(', ')}.`);
      process.exit(1);
    }

    console.log('Uploading the figures…');
    await putFigures();

    const rows = entries.map((entry) => rowsFor(entry, subjects.get(entry.subject)));
    await prisma.$transaction([
      prisma.question.createMany({ data: rows.map((r) => r.question), skipDuplicates: true }),
      prisma.questionVersion.createMany({ data: rows.map((r) => r.version), skipDuplicates: true }),
    ]);
    const linked = await prisma.$executeRawUnsafe(
      `UPDATE "Question" SET "currentVersionId" = 'qvg_' || substring("id" from 4) WHERE 'golden' = ANY("tags") AND "currentVersionId" IS NULL`,
    );

    console.log(
      `\nDone. ${rows.length} golden questions (${linked} linked to versions), tagged 'golden'.`,
    );
    console.log(`  Figures: ${FIGURES.map(([key]) => urlOf(key)).join('\n           ')}`);
    console.log(`Purge with: node scripts/dev-seed-golden-questions.mjs --reset`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
