// The Kara login theme's page script.
//  - PatternFly dark, always (Kara's login page is dark whatever the OS says).
//  - The header: Kara's logo, name and subtitle instead of the realm's name.
//  - On wide screens, Kara's heading and features beside the card.
document.documentElement.classList.add("pf-v5-theme-dark");
document.addEventListener("DOMContentLoaded", function () {
  var res = (document.querySelector('link[href*="/css/kara.css"]') || {}).href;
  var base = res ? res.replace(/\/css\/kara\.css.*$/, "") : "";

  var header = document.getElementById("kc-header-wrapper");
  if (header) {
    header.textContent = "";
    var logo = document.createElement("img");
    logo.className = "kara-logo";
    logo.alt = "";
    logo.src = base + "/img/kara-logo.png";
    var name = document.createElement("div");
    name.className = "kara-name";
    name.textContent = "سیمرغ‌کارا";
    var sub = document.createElement("div");
    sub.className = "kara-sub";
    sub.textContent = "سامانهٔ یکپارچهٔ مدیریت سازمان";
    header.append(logo, name, sub);
  }

  var aside = document.createElement("section");
  aside.className = "kara-aside";
  aside.setAttribute("aria-hidden", "true");
  var h2 = document.createElement("h2");
  var gold = document.createElement("span");
  gold.textContent = "سامانهٔ یکپارچهٔ";
  h2.append(gold, document.createElement("br"), "مدیریت سازمان");
  var p = document.createElement("p");
  p.textContent = "منابع انسانی، حضور و غیاب هوشمند، کارتابل و میز کار، مرخصی و حسابداری — همه در یک پلتفرم چندشرکتی.";
  var ul = document.createElement("ul");
  ["حضور و غیاب با دستگاه و تشخیص چهره", "گردش‌کار مرخصی و کارتابل", "تقویم کاری و میز کار تیمی", "گزارش‌های تحلیلی و داشبورد مدیریتی"]
    .forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.append(li); });
  aside.append(h2, p, ul);
  document.body.append(aside);
});
