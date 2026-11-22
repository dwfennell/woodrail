// The index also opens directly from disk. Native hash links keep detail pages bookmarkable.
const cards = [...document.querySelectorAll("article")];
const gallery = document.querySelector("main");
const overview = document.querySelector("header");
const detail = document.querySelector("#detail");
const search = document.querySelector("#query");
const collection = document.querySelector("#family");
const revised = document.querySelector("#revised");
const total = document.querySelector("#count");
const byRoute = new Map(cards.map(card => [card.querySelector("a").hash, card]));
let selected;

function filterCards() {
  const term = search.value.toLowerCase().trim();
  let count = 0;
  for (const card of cards) {
    const changed = card.hasAttribute("data-changed");
    card.hidden = card.dataset.family !== collection.value || (revised.checked && !changed) || !card.textContent.toLowerCase().includes(term);
    if (!card.hidden) count++;
  }
  total.value = count + " entries";
}

function portrait(card, version) {
  const original = version === "before";
  const url = card.dataset[version];
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = card.querySelector("h2").textContent + ", " + version;
    return img;
  }
  const photo = card.querySelector(".photo, img").cloneNode(true);
  if (original && card.dataset.atlas) photo.style.backgroundImage = 'url("' + card.dataset.atlas + '")';
  return photo;
}

function showRoute() {
  const card = byRoute.get(location.hash);
  overview.hidden = gallery.hidden = Boolean(card);
  detail.hidden = !card;
  if (!card) {
    document.title = "Woodrail asset index";
    if (selected) selected.querySelector("a").focus();
    return;
  }
  selected = card;
  collection.value = card.dataset.family;
  filterCards();
  const title = card.querySelector("h2").textContent;
  document.title = title + " · Woodrail asset index";
  detail.querySelector("h1").textContent = title;
  detail.querySelector(".identity").textContent = card.dataset.family + " · " + card.querySelector("small:last-child").textContent;
  const changed = card.hasAttribute("data-changed");
  const note = detail.querySelector(".note");
  note.hidden = !card.dataset.note;
  note.textContent = card.dataset.note || "";
  detail.querySelector(".after strong").textContent = changed ? "After" : "Current";
  detail.querySelector(".pair").classList.toggle("single", !changed);
  for (const version of ["before", "after"]) {
    const figure = detail.querySelector("." + version);
    figure.hidden = version === "before" && !changed;
    if (figure.hidden) continue;
    figure.querySelector(".frame").replaceChildren(portrait(card, changed ? version : "current"));
    figure.querySelector("small").textContent = card.dataset[version + "Count"] || "";
  }
  const siblings = cards.filter(item => !item.hidden || item === card);
  const i = siblings.indexOf(card);
  for (const [direction, neighbor] of [["previous", siblings[i - 1]], ["next", siblings[i + 1]]]) {
    const a = detail.querySelector("." + direction);
    a.hidden = !neighbor;
    if (neighbor) a.href = neighbor.querySelector("a").hash;
  }
  detail.querySelector("h1").focus({preventScroll:true});
  window.scrollTo(0, 0);
}

collection.addEventListener("change", filterCards);
revised.addEventListener("change", filterCards);
search.addEventListener("input", filterCards);
window.addEventListener("hashchange", showRoute);
filterCards();
showRoute();
