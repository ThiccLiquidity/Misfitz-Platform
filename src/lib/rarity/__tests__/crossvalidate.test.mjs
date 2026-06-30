// Regression stress test: our OpenRarity estimator must reproduce MintGarden's OFFICIAL openrarity_rank
// (the industry standard) on real data. Fixtures are live ChiaPhunks NFTs (traits + official rank).
// Asserts (1) identical rank ORDER to MintGarden and (2) mean absolute rank error within tolerance.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRankEstimator } from "../estimateRank.ts";

const TOTAL = 9985;
const freq = {"ear":{"gold earring":2928},"body":{"ape":23,"male":5837,"alien":9,"female":3705,"zombie":87,"vampire":61,"deadpool":6,"hedronian":5,"zombie ape":1},"eyes":{"red eyeshadow":92,"gray eyeshadow":99,"rose eyeshadow":126,"teal eyeshadow":80,"blue clown eyes":77,"green clown eyes":89,"lavender eyeshadow":91},"lips":{"red lipstick":245,"black lipstick":205,"purple lipstick":274,"neutral lipstick":261},"mood":{"sad":249,"happy":245},"neck":{"choker":304,"gold chain":1051,"silver chain":959},"nose":{"clown nose":134,"red clown nose":59},"marks":{"mole":448,"spots":452,"hickey":8,"birthmark":122,"lions den":88,"rosy cheeks":417},"mouth":{"goatee":212,"big beard":217,"chad beard":221,"chin strap":212,"full beard":110,"handlebars":214,"front beard":223,"hard stache":138,"shadow beard":221,"black muttons":215,"blonde goatee":227,"copper stache":208,"blonde muttons":227,"short black beard":224,"short blonde beard":227},"teeth":{"buck teeth":135},"eyewear":{"eyemask":249,"goggles":301,"eye patch":272,"3d glasses":270,"hex visors":160,"sun shades":273,"nerd glasses":268,"pulse visors":128,"matrix shades":282,"og hex shades":234,"pulsex visors":166,"classic shades":299,"compact shades":247,"blue clown eyes":164,"circular shades":260,"classic goggles":61,"green clown eyes":189},"headpiece":{"crown":88,"beanie":83,"doorag":92,"fedora":92,"mullet":78,"70s cut":101,"man bun":100,"og afro":99,"top hat":183,"bowl cut":89,"dev hair":75,"emo hair":94,"headband":73,"mid afro":99,"pigtails":92,"pimp hat":91,"dark hair":79,"messy bun":100,"nurse cap":92,"og blonde":85,"pilot cap":98,"pimp hair":77,"pink hair":86,"saudi cap":156,"blonde bob":89,"bravo hair":91,"bushy hair":87,"chill hair":85,"cowboy hat":96,"crazy hair":169,"curly hair":88,"gold tiara":93,"ivory hair":106,"litty hair":104,"messy hair":179,"panama hat":81,"phunky cap":177,"police cap":185,"rambo hair":85,"red beanie":159,"red mohawk":102,"sailor cap":97,"classic cap":84,"cowgirl hat":94,"green beret":98,"half shaved":82,"knitted cap":171,"orange hair":84,"shaved head":109,"short black":96,"spikey hair":91,"tennis band":82,"bandido hair":84,"black mohawk":78,"classic afro":81,"doctor scope":83,"escobar hair":91,"messy blonde":81,"military cap":176,"red rekt cap":175,"short blonde":82,"stringy hair":77,"vampire hair":104,"blonde mohawk":109,"phunky hoodie":184,"phunky mohawk":90,"purple beanie":101,"black rekt cap":84,"classic hoodie":178,"classic mohawk":100,"party sombrero":162,"red clown hair":104,"classic bandana":173,"green side hair":89,"long black hair":84,"thin black hair":87,"black clown hair":100,"black messy hair":107,"classic sombrero":178,"clean cut blonde":78,"green clown hair":187,"punisher bandana":106,"clean cut brunette":86,"clean cut black hair":83},"mouthpiece":{"pipe":577,"vape":581,"doobie":620,"cigarette":622,"surgical mask":315},"meta_trait:trait_count":{"1":10,"2":347,"3":3561,"4":3437,"5":1932,"6":371,"7":75,"8":1}};

const samples = [
  { name: "#1",    mg: 844,  traits: [["Body","Male"],["Headpiece","Bowl Cut"],["Mood","Happy"],["Eyewear","Green Clown Eyes"],["Neck","Gold Chain"]] },
  { name: "#36",   mg: 1009, traits: [["Body","Male"],["Headpiece","Cowboy Hat"],["Mood","Sad"],["Eyewear","Circular Shades"],["Neck","Gold Chain"]] },
  { name: "#1195", mg: 3000, traits: [["Body","Male"],["Mouth","Big Beard"],["Mouthpiece","Pipe"],["Eyewear","Classic Shades"]] },
  { name: "#3062", mg: 6477, traits: [["Body","Male"],["Headpiece","Escobar Hair"],["Mood","Happy"]] },
  { name: "#1915", mg: 7090, traits: [["Body","Male"],["Headpiece","Phunky Mohawk"],["Mouth","Blonde Muttons"]] },
  { name: "#3855", mg: 9679, traits: [["Body","Male"],["Headpiece","Red Rekt Cap"],["Ear","Gold Earring"]] },
  { name: "#2007", mg: 9729, traits: [["Body","Male"],["Headpiece","Green Clown Hair"],["Ear","Gold Earring"]] },
];
const toTraits = (pairs) => pairs.map(([trait_type, value]) => ({ trait_type, value }));

test("estimator builds from a real frequency table", () => {
  assert.ok(buildRankEstimator(freq, TOTAL));
});

test("our rank ORDER matches MintGarden's official OpenRarity order", () => {
  const est = buildRankEstimator(freq, TOTAL);
  const rows = samples.map((s) => ({ name: s.name, mg: s.mg, our: est.rankOf(toTraits(s.traits)) }));
  const byMg = [...rows].sort((a, b) => a.mg - b.mg).map((r) => r.name).join(",");
  const byOur = [...rows].sort((a, b) => a.our - b.our).map((r) => r.name).join(",");
  assert.equal(byOur, byMg);
});

test("mean absolute rank error vs MintGarden is within 10% of supply", () => {
  const est = buildRankEstimator(freq, TOTAL);
  const errs = samples.map((s) => Math.abs(est.rankOf(toTraits(s.traits)) - s.mg));
  const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
  assert.ok(mae / TOTAL < 0.10, `MAE ${mae} (${(mae / TOTAL * 100).toFixed(1)}%) should be < 10%`);
});
