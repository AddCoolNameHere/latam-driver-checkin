/* Financial Report · Aceolution LATAM. Static statements + period-verified online operations. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => escapeHtml(value);
  const costKeys = ['card','payroll','pmSalary','seatCharges','procurement','cashTransfers','otherIndirect'];
  const overheadKeys = ['pmSalary','seatCharges','procurement','otherIndirect'];
  const codes = ['AR','BR','CL','CO','MX','PE'];
  const countryLabels = {AR:['Argentina','Argentina','Argentina'],BR:['Brasil','Brasil','Brazil'],CL:['Chile','Chile','Chile'],CO:['Colômbia','Colombia','Colombia'],MX:['México','México','Mexico'],PE:['Peru','Perú','Peru']};
  const icons = {sliders:'<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',screen:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',revenue:'<path d="M4 18V6m0 12h16M7 13l4-4 4 2 5-6"/>',expenses:'<path d="M4 6h16v14H4zM8 3v6m8-6v6M8 13h8m-8 3h5"/>',profit:'<path d="M12 3v18m5-14H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6"/>',margin:'<path d="m5 19 14-14"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>'};
  const tabs=['opening','revenue','costs','overview','countries','idle','scenarios','sources'];
  const defaultSettings = {title:'',target:15,unit:'full',currency:'USD',commentTitle:'',commentText:'',revenueChange:0,costChange:0,horizon:3};
  let settings = {...defaultSettings};
  function readStorage(key) { try { return localStorage.getItem(key); } catch(error) { return null; } }
  let lang = ['pt','es','en'].includes(readStorage('latam.lang')) ? readStorage('latam.lang') : 'pt';
  let user = null, data = null, sourceData = null, imported = false;
  let state = {country:'ALL',start:9,end:9,tab:'opening'};
  let operationResult = null, operationKey = '', operationSequence = 0, toastTimer;
  let idleResult=null,idleKey='',idleSequence=0,idleRange='ytd',idleMetric='idleDays';

  function t(key, values) {
    let text = window.FINANCIAL_I18N?.[lang]?.[key] ?? key;
    Object.entries(values || {}).forEach(([name,value]) => { text = text.replaceAll(`{${name}}`, String(value)); });
    return text;
  }
  function localized(value) { return typeof value === 'object' && value ? value[lang] || value.en || value.pt || '' : value || ''; }
  function locale() { return {pt:'pt-BR',es:'es-ES',en:'en-US'}[lang]; }
  function countryName(code) { return code === 'ALL' ? t('allCountries') : countryLabels[code]?.[['pt','es','en'].indexOf(lang)] || code; }
  function n(value, digits=0) { return Number.isFinite(value) ? new Intl.NumberFormat(locale(),{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value) : '—'; }
  function money(value, precise=false) {
    if (!Number.isFinite(value)) return '—';
    const scaled = !precise && settings.unit === 'thousands';
    const prefix = 'USD';
    return `${value < 0 ? '−' : ''}${prefix} ${n(Math.abs(value)/(scaled ? 1000 : 1),precise ? 2 : scaled ? 1 : 0)}${scaled ? 'k' : ''}`;
  }
  function pct(value, digits=1) { return Number.isFinite(value) ? `${n(value*100,digits)}%` : '—'; }
  function monthName(month, short=false) { return new Intl.DateTimeFormat(locale(),{month:short?'short':'long',timeZone:'UTC'}).format(new Date(Date.UTC(data.meta.year,month-1,1))); }
  function periodLabel(start=state.start,end=state.end) { return `${monthName(start,true)}${start !== end ? ' – '+monthName(end,true) : ''} ${data.meta.year}`; }
  function signed(value, formatter=n) { return `${value>0?'+':''}${formatter(value)}`; }
  function signClass(value) { return value < -1e-9 ? 'fr-negative' : 'fr-positive'; }
  function svgIcon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`; }
  function storageKey(kind) { return `AC_FINANCIAL_${kind}_V1_${user.username}`; }
  function persistSettings() {
    try { localStorage.setItem(storageKey('SETTINGS'),JSON.stringify({settings,state})); return true; }
    catch (error) { toast(t('storageUnavailable')); return false; }
  }
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }

  // Validate inputs and recompute derived measures rather than trusting uploaded totals.
  function validateData(input) {
    if (!input || input.schemaVersion !== 1 || !input.meta || !Number.isInteger(input.meta.year) || input.meta.year < 2000 || input.meta.year > 2100 || !Array.isArray(input.records) || !input.records.length || input.records.length > 72) throw new Error('schema');
    const result = JSON.parse(JSON.stringify(input));
    if(result.meta.currency && result.meta.currency!=='USD')throw new Error('currency');
    result.meta.currency='USD';
    if(Array.isArray(result.reconciliation?.issues))result.reconciliation.issues=result.reconciliation.issues.filter(issue=>issue.id!=='currency_unconfirmed');
    const seen = new Set();
    const validNumber = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
    result.records.forEach(row => {
      if (!codes.includes(row.countryCode) || !Number.isInteger(row.month) || row.month<1 || row.month>12 || seen.has(`${row.countryCode}:${row.month}`)) throw new Error('record');
      seen.add(`${row.countryCode}:${row.month}`);
      if (!['income','billables','managementFees','revenue','expenses'].every(key=>validNumber(row[key])) || !row.costs || !costKeys.every(key=>validNumber(row.costs[key]))) throw new Error('number');
      if (Math.abs(row.revenue-row.income-row.billables-row.managementFees)>.05 || Math.abs(row.expenses-costKeys.reduce((sum,key)=>sum+row.costs[key],0))>.05) throw new Error('reconciliation');
      row.allocatedOverhead=overheadKeys.reduce((sum,key)=>sum+row.costs[key],0);
      row.localExpenses=row.expenses-row.allocatedOverhead;
      row.contributionProfit=row.revenue-row.localExpenses;
      row.profit=row.revenue-row.expenses;
      row.margin=row.revenue !== 0 ? row.profit/row.revenue : null;
      row.contributionMargin=row.revenue !== 0 ? row.contributionProfit/row.revenue : null;
      row.returnOnCost=row.expenses !== 0 ? row.profit/row.expenses : null;
      row.period=`${result.meta.year}-${String(row.month).padStart(2,'0')}`;
    });
    const months=[...new Set(result.records.map(row=>row.month))].sort((a,b)=>a-b);
    // A missing country is not a zero. Require a full six-country monthly close.
    if (months.some(month=>codes.some(code=>!seen.has(`${code}:${month}`))) || months.some((month,i)=>i && month!==months[i-1]+1)) throw new Error('coverage');
    result.months=months.map(month=>({month,period:`${result.meta.year}-${String(month).padStart(2,'0')}`}));
    result.countries=codes.map(code=>({code,name:countryLabels[code][2]}));
    result.meta.firstMonth=months[0]; result.meta.lastMonth=months.at(-1);
    if (!Array.isArray(result.costCategories) || result.costCategories.length!==costKeys.length || new Set(result.costCategories.map(category=>category.id)).size!==costKeys.length || costKeys.some(key=>!result.costCategories.find(category=>category.id===key))) throw new Error('categories');
    if (result.cardCategoryRecords != null) {
      if (!Array.isArray(result.cardCategoryRecords) || result.cardCategoryRecords.length > 10000) throw new Error('card');
      const cardTotals=new Map();
      result.cardCategoryRecords.forEach(row=>{
        if (!codes.includes(row.countryCode) || !months.includes(row.month) || !validNumber(row.amount) || !Number.isInteger(row.transactions) || row.transactions<0 || typeof row.category!=='string' || row.category.length>160) throw new Error('card');
        const key=`${row.countryCode}:${row.month}`; cardTotals.set(key,(cardTotals.get(key)||0)+row.amount);
      });
      if (result.cardCategoryRecords.length && result.records.some(row=>Math.abs((cardTotals.get(`${row.countryCode}:${row.month}`)||0)-row.costs.card)>.05)) throw new Error('card-total');
    }
    result.totals=aggregate(result.records);
    result.monthly=months.map(month=>({month,period:`${result.meta.year}-${String(month).padStart(2,'0')}`,...aggregate(result.records.filter(row=>row.month===month))}));
    result.countryTotals=codes.map(countryCode=>({countryCode,country:countryLabels[countryCode][2],...aggregate(result.records.filter(row=>row.countryCode===countryCode))}));
    result.meta.recordCount=result.records.length;
    result.meta.countryCount=codes.length;
    return result;
  }
  function sanitizeSettings(input) {
    if (!input || typeof input!=='object') throw new Error('settings');
    const out={...defaultSettings};
    ['title','commentTitle','commentText'].forEach(key=>{if(input[key]!=null){if(typeof input[key]!=='string') throw new Error(key);out[key]=input[key].slice(0,key==='commentText'?4000:key==='title'?90:100);}});
    if(input.target!=null){if(!Number.isFinite(input.target)||input.target< -100||input.target>=100)throw new Error('target');out.target=input.target;}
    if(input.unit!=null){if(!['full','thousands'].includes(input.unit))throw new Error('unit');out.unit=input.unit;}
    out.currency='USD';
    ['revenueChange','costChange'].forEach(key=>{if(input[key]!=null){if(!Number.isFinite(input[key])||input[key]< -50||input[key]>50)throw new Error(key);out[key]=input[key];}});
    if(input.horizon!=null){if(![1,3,6,12].includes(input.horizon))throw new Error('horizon');out.horizon=input.horizon;}
    return out;
  }
  function rowsFor(country=state.country,start=state.start,end=state.end) { return data.records.filter(row=>(country==='ALL'||row.countryCode===country)&&row.month>=start&&row.month<=end); }
  function aggregate(rows) {
    const result={income:0,billables:0,managementFees:0,revenue:0,expenses:0,profit:0,allocatedOverhead:0,localExpenses:0,contributionProfit:0,costs:Object.fromEntries(costKeys.map(key=>[key,0]))};
    rows.forEach(row=>{Object.keys(result).filter(key=>key!=='costs').forEach(key=>result[key]+=row[key]);costKeys.forEach(key=>result.costs[key]+=row.costs[key]);});
    result.margin=result.revenue!==0?result.profit/result.revenue:null;
    result.contributionMargin=result.revenue!==0?result.contributionProfit/result.revenue:null;
    result.returnOnCost=result.expenses!==0?result.profit/result.expenses:null;
    return result;
  }
  function selectedCountries() { return (state.country==='ALL'?codes:[state.country]).map(code=>({code,...aggregate(rowsFor(code))})); }
  function applyLanguage() {
    document.documentElement.lang={pt:'pt-BR',es:'es',en:'en'}[lang];
    document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n);});
    document.querySelectorAll('[data-icon]').forEach(el=>{el.querySelectorAll('svg').forEach(icon=>icon.remove());el.insertAdjacentHTML('afterbegin',svgIcon(el.dataset.icon));});
    document.querySelectorAll('[data-label]').forEach(el=>{el.setAttribute('aria-label',t(el.dataset.label));el.title=t(el.dataset.label);});
    document.querySelectorAll('[data-lang]').forEach(el=>el.classList.toggle('active',el.dataset.lang===lang));
    document.querySelector('.fr-tabs').setAttribute('aria-label',t('overview'));
    $('report-title').textContent=settings.title||t('title');
    document.title=`${settings.title||t('title')} · LATAM · Aceolution`;
    if(data) { fillFilters();render(); }
  }
  function fillFilters() {
    const min=data.meta.firstMonth,max=data.meta.lastMonth;
    if(!codes.includes(state.country)&&state.country!=='ALL')state.country='ALL';
    state.start=Math.min(max,Math.max(min,Number.isInteger(Number(state.start))?Number(state.start):max));
    state.end=Math.min(max,Math.max(state.start,Number.isInteger(Number(state.end))?Number(state.end):max));
    $('country-filter').innerHTML=['ALL',...codes].map(code=>`<option value="${code}">${esc(countryName(code))}</option>`).join('');
    const options=data.months.map(({month})=>`<option value="${month}">${esc(monthName(month))} ${data.meta.year}</option>`).join('');
    $('start-filter').innerHTML=options;$('end-filter').innerHTML=options;
    $('country-filter').value=state.country;$('start-filter').value=state.start;$('end-filter').value=state.end;
  }
  function render() {
    const total=aggregate(rowsFor());
    $('report-title').textContent=settings.title||t('title');
    $('report-period').textContent=`${countryName(state.country)} / ${periodLabel()}`;
    $('trend-period').textContent=periodLabel(data.meta.firstMonth,data.meta.lastMonth);
    $('financial-source').textContent=`${t(imported?'importedActuals':'actuals')} · ${data.meta.year}`;
    $('unit-label').textContent=settings.unit==='thousands'?`${t('thousandsUnit')} · USD`:t('sourceUnit');
    $('footer-context').textContent=`${periodLabel()} · ${countryName(state.country)} · ${t('internal')}`;
    $('ytd-btn').classList.toggle('active',state.start===1);
    $('ytd-btn').disabled=data.meta.firstMonth!==1;
    $('mbr-btn').classList.toggle('active',state.country==='ALL'&&state.start===9&&state.end===9);
    $('mbr-btn').hidden=!data.months.some(row=>row.month===9);
    $('latest-btn').classList.toggle('active',state.start===data.meta.lastMonth&&state.end===data.meta.lastMonth);
    renderKpis(total);renderTrend();renderInsights(total);renderCountryBars();renderTables(total);renderCosts(total);renderScenario();renderSources();renderOperations();renderMbr();renderIdle();
    $('editorial-card').hidden=!settings.commentText.trim();$('editorial-title').textContent=settings.commentTitle||t('managementCommentary');$('editorial-text').textContent=settings.commentText;
    setTab(state.tab,false);
  }
  function renderMbr() { window.FinancialMbr.render({data,state,settings,imported,t,esc,n,money,pct,signed,monthName,periodLabel,countryName,localized,aggregate,rowsFor,selectedCountries,signClass,costKeys}); }
  function deltaText(key,current,previous) {
    if(!previous || Math.abs(previous[key])<.00001)return t('noPrevious');
    return `${signed((current[key]-previous[key])/Math.abs(previous[key]),value=>pct(value))} ${t('vsPrevious')}`;
  }
  function renderKpis(total) {
    const length=state.end-state.start+1;
    const previous=state.start-length>=data.meta.firstMonth?aggregate(rowsFor(state.country,state.start-length,state.start-1)):null;
    const definitions=[['revenue',total.revenue,deltaText('revenue',total,previous)],['expenses',total.expenses,deltaText('expenses',total,previous)],['profit',total.profit,t('afterAllocation')],['margin',total.margin,`${t('target')} ${pct(settings.target/100)} · ${t('returnOnCost')} ${pct(total.returnOnCost)}`]];
    $('kpis').innerHTML=definitions.map(([key,value,foot])=>`<article class="fr-kpi ${key==='profit'?'fr-kpi-focus':''}"><div class="fr-kpi-label"><span>${esc(t(key))}</span>${svgIcon(key)}</div><div class="fr-kpi-value ${(key==='profit'||key==='margin')?signClass(value):''}" title="${esc(key==='margin'?pct(value,2):money(value,true))}">${esc(key==='margin'?pct(value):money(value))}</div><p class="fr-footnote">${esc(foot)}</p></article>`).join('');
  }
  function renderTrend() {
    const series=data.months.map(({month})=>({month,...aggregate(rowsFor(state.country,month,month))}));
    const width=680,height=250,left=54,right=12,top=18,bottom=36;
    const max=Math.max(...series.flatMap(row=>[row.revenue,row.expenses,row.profit]),1)*1.1;
    const min=Math.min(...series.map(row=>row.profit),0)*1.2;
    const plotHeight=height-top-bottom,plotWidth=width-left-right,step=plotWidth/series.length;
    const y=value=>top+(max-value)/(max-min)*plotHeight,zero=y(0);
    let content='';
    for(let i=0;i<=4;i++){const value=min+(max-min)*i/4;content+=`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left-9}" y="${y(value)+3}" text-anchor="end">${esc(n(value/1000,0))}k</text>`;}
    series.forEach(row=>{const i=series.indexOf(row),x=left+step*(i+.5),barWidth=Math.min(18,step*.25),active=row.month>=state.start&&row.month<=state.end;const title=`${monthName(row.month)}: ${t('revenue')} ${money(row.revenue,true)}; ${t('expenses')} ${money(row.expenses,true)}; ${t('profit')} ${money(row.profit,true)}`;
      content+=`<g data-month="${row.month}" role="button" tabindex="0" aria-label="${esc(title)}"><title>${esc(title)}</title>${active?`<rect x="${x-step*.44}" y="${top-8}" width="${step*.88}" height="${plotHeight+12}" rx="5" fill="var(--c-bg-tint)"/>`:''}<rect x="${x-barWidth-2}" y="${Math.min(y(row.revenue),zero)}" width="${barWidth}" height="${Math.max(1,Math.abs(zero-y(row.revenue)))}" rx="2" fill="var(--fr-revenue)"/><rect x="${x+2}" y="${Math.min(y(row.expenses),zero)}" width="${barWidth}" height="${Math.max(1,Math.abs(zero-y(row.expenses)))}" rx="2" fill="var(--fr-expense)"/><text x="${x}" y="${height-12}" text-anchor="middle">${esc(monthName(row.month,true))}</text></g>`;
    });
    content+=`<line x1="${left}" x2="${width-right}" y1="${zero}" y2="${zero}" stroke="var(--c-border-strong)"/><path d="${series.map((row,i)=>`${i?'L':'M'}${left+step*(i+.5)},${y(row.profit)}`).join(' ')}" fill="none" stroke="var(--fr-profit)" stroke-width="2.5"/>`;
    series.forEach((row,i)=>{content+=`<circle cx="${left+step*(i+.5)}" cy="${y(row.profit)}" r="3.5" fill="var(--c-surface)" stroke="var(--fr-profit)" stroke-width="2"><title>${esc(monthName(row.month)+': '+money(row.profit,true))}</title></circle>`;});
    $('trend-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(t('trendTitle'))}">${content}</svg>`;
  }
  function renderInsights(total) {
    const countries=selectedCountries().sort((a,b)=>b.revenue-a.revenue);
    const leader=countries[0];
    const topCost=data.costCategories.map(category=>({...category,value:total.costs[category.id]})).sort((a,b)=>b.value-a.value)[0];
    const items=[{title:`${t('currentResult')} · ${t(total.profit>=0?'profitable':'lossMaking')}`,body:t('resultText',{profit:money(total.profit),margin:pct(total.margin)})},{title:t('largestRevenue'),body:t('concentrationText',{country:countryName(leader.code),share:pct(total.revenue?leader.revenue/total.revenue:null)})},{title:t('largestCost'),body:t('costText',{category:localized(topCost.label),share:pct(total.expenses?topCost.value/total.expenses:null)})}];
    $('insights').innerHTML=items.map(item=>`<div class="fr-insight"><h3 class="fr-insight-heading">${esc(item.title)}</h3><p>${esc(item.body)}</p></div>`).join('');
    const gap=Number.isFinite(total.margin)?settings.target-total.margin*100:null;
    $('target-note').innerHTML=`${esc(gap===null?t('noRevenue'):t('marginTargetText',{target:pct(settings.target/100),gap:signed(-gap,value=>n(value,1))}))}<div class="fr-target-track"><span style="width:${Math.max(0,Math.min(100,settings.target>0&&total.margin!==null?total.margin*100/settings.target*100:0))}%"></span></div>`;
  }
  function renderCountryBars() {
    const rows=selectedCountries().sort((a,b)=>b.profit-a.profit),max=Math.max(...rows.map(row=>Math.abs(row.profit)),1);
    $('country-bars').innerHTML=rows.map(row=>`<button type="button" class="fr-country-row" data-country="${row.code}" title="${esc(t('afterAllocation')+': '+money(row.profit,true))}"><span class="fr-country-code">${row.code}</span><span class="fr-country-name">${esc(countryName(row.code))}</span><span class="fr-country-track"><span class="fr-country-fill" style="width:${Math.abs(row.profit)/max*100}%;background:var(${row.profit<0?'--fr-negative':'--fr-positive'})"></span></span><span class="fr-country-value ${signClass(row.profit)}">${esc(money(row.profit))}</span></button>`).join('')+`<p class="fr-footnote">${esc(t('afterAllocation'))}</p>`;
  }
  function tableRow(label,row,country) {
    return `<tr><td>${country?`<button type="button" class="fr-text-btn fr-country-cell" data-country="${country}"><span class="fr-country-code">${country}</span>${esc(label)}</button>`:esc(label)}</td><td>${esc(money(row.revenue))}</td><td>${esc(money(row.localExpenses))}</td><td class="${signClass(row.contributionProfit)}">${esc(money(row.contributionProfit))}</td><td>${esc(money(row.allocatedOverhead))}</td><td class="${signClass(row.profit)}">${esc(money(row.profit))}</td><td class="${signClass(row.margin)}">${esc(pct(row.margin))}</td><td>${esc(pct(row.returnOnCost))}</td></tr>`;
  }
  function renderTables(total) {
    const head=first=>`<thead><tr>${[first,'revenue','localExpenses','contributionProfit','allocatedOverhead','profit','margin','returnOnCost'].map(key=>`<th scope="col">${esc(t(key))}</th>`).join('')}</tr></thead>`;
    $('country-table').innerHTML=`<table class="fr-table"><caption>${esc(t('fullPrecisionNote'))}</caption>${head('country')}<tbody>${selectedCountries().sort((a,b)=>b.revenue-a.revenue).map(row=>tableRow(countryName(row.code),row,row.code)).join('')}</tbody><tfoot>${tableRow(t('total'),total)}</tfoot></table>`;
    $('monthly-table').innerHTML=`<table class="fr-table">${head('month')}<tbody>${data.months.filter(({month})=>month>=state.start&&month<=state.end).map(({month})=>tableRow(monthName(month),aggregate(rowsFor(state.country,month,month)))).join('')}</tbody><tfoot>${tableRow(t('total'),total)}</tfoot></table>`;
  }
  function renderCosts(total) {
    const categories=data.costCategories.map(category=>({...category,value:total.costs[category.id]})).sort((a,b)=>b.value-a.value),max=Math.max(...categories.map(row=>Math.abs(row.value)),1);
    $('cost-breakdown').innerHTML=`<div class="fr-cost-total"><span>${esc(t('expenses'))}</span><strong>${esc(money(total.expenses))}</strong></div>`+categories.map((row,i)=>`<div class="fr-cost-row"><span>${esc(localized(row.label))}</span><span class="fr-country-track"><span class="fr-country-fill" style="width:${Math.abs(row.value)/max*100}%;background:var(--fr-revenue);opacity:${1-i*.09}"></span></span><strong>${esc(money(row.value))}</strong><span class="fr-muted">${esc(pct(total.expenses?row.value/total.expenses:null,0))}</span></div>`).join('');
    $('profit-bridge').innerHTML=[['income',total.income],['billables',total.billables],['managementFees',total.managementFees],['revenue',total.revenue],['localExpenses',-total.localExpenses],['contributionProfit',total.contributionProfit],['allocatedOverhead',-total.allocatedOverhead],['profit',total.profit]].map(([key,value])=>`<div class="fr-bridge-row ${key==='profit'?'fr-bridge-total':''}"><span>${esc(t(key))}</span><strong class="${['profit','contributionProfit'].includes(key)?signClass(value):''}">${esc(money(value))}</strong></div>`).join('');
    const grouped=new Map();
    (data.cardCategoryRecords||[]).filter(row=>(state.country==='ALL'||row.countryCode===state.country)&&row.month>=state.start&&row.month<=state.end).forEach(row=>{const group=grouped.get(row.category)||{category:row.category,amount:0,transactions:0};group.amount+=row.amount;group.transactions+=row.transactions;grouped.set(row.category,group);});
    const rows=[...grouped.values()].sort((a,b)=>b.amount-a.amount);
    $('card-categories').innerHTML=rows.length?`<div class="fr-table-scroll"><table class="fr-table"><thead><tr>${['category','transactions','value','share'].map(key=>`<th scope="col">${esc(t(key))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(localized(data.cardCategoryLabels?.[row.category])||row.category)}</td><td>${n(row.transactions)}</td><td>${esc(money(row.amount))}</td><td>${pct(total.costs.card?row.amount/total.costs.card:null)}</td></tr>`).join('')}</tbody><tfoot><tr><td>${esc(t('total'))}</td><td>${n(rows.reduce((sum,row)=>sum+row.transactions,0))}</td><td>${esc(money(rows.reduce((sum,row)=>sum+row.amount,0)))}</td><td>${total.costs.card?'100%':'—'}</td></tr></tfoot></table></div>`:`<p class="fr-muted">${esc(t('costCoverage'))}</p>`;
  }
  function renderScenario() {
    $('revenue-change').value=settings.revenueChange;$('cost-change').value=settings.costChange;$('horizon').value=settings.horizon;
    $('revenue-change-value').textContent=signed(settings.revenueChange/100,pct);$('cost-change-value').textContent=signed(settings.costChange/100,pct);
    const total=aggregate(rowsFor()),count=state.end-state.start+1;
    const baseRevenue=total.revenue/count*settings.horizon,baseExpenses=total.expenses/count*settings.horizon;
    const revenue=baseRevenue*(1+settings.revenueChange/100),expenses=baseExpenses*(1+settings.costChange/100),profit=revenue-expenses,margin=revenue?profit/revenue:null;
    const delta=profit-(baseRevenue-baseExpenses),target=settings.target/100;
    const savings=Math.max(0,expenses-revenue*(1-target));
    $('scenario-horizon').textContent=`${settings.horizon} ${t('monthsLabel')}`;
    $('scenario-result').innerHTML=`<div class="fr-scenario-summary"><div class="fr-section-number">${esc(t('projectedProfit'))}</div><div class="fr-scenario-profit ${signClass(profit)}">${esc(money(profit))}</div><p>${esc(t('projectedMargin'))}: <strong>${pct(margin)}</strong> · ${esc(t('scenarioDelta'))}: <strong class="${signClass(delta)}">${esc(signed(delta,money))}</strong></p></div>`+[['projectedRevenue',money(revenue)],['projectedExpenses',money(expenses)],['breakEven',money(expenses)],['requiredRevenue',money(expenses/(1-target))],['savingsNeeded',savings>0?money(savings):t('noSavingsNeeded')]].map(([key,value])=>`<div class="fr-bridge-row"><span>${esc(t(key))}${key==='requiredRevenue'?` (${pct(target)})`:''}</span><strong>${esc(value)}</strong></div>`).join('')+`<p class="fr-footnote">${esc(t('baseCase'))}: ${esc(periodLabel())} / ${count} ${esc(t('monthsLabel'))}. ${esc(t('scenarioBase'))}</p>`;
    const offsets=[-10,-5,0,5,10];
    $('sensitivity').innerHTML=`<table class="fr-table fr-sensitivity"><caption>${esc(t('costAxis'))} / ${esc(t('revenueAxis'))}</caption><thead><tr><th>${esc(t('costChange'))} ↓ / ${esc(t('revenueChange'))} →</th>${offsets.map(offset=>`<th>${signed((settings.revenueChange+offset)/100,pct)}</th>`).join('')}</tr></thead><tbody>${offsets.map(costOffset=>`<tr><th scope="row">${signed((settings.costChange+costOffset)/100,pct)}</th>${offsets.map(revenueOffset=>{const result=baseRevenue*(1+(settings.revenueChange+revenueOffset)/100)-baseExpenses*(1+(settings.costChange+costOffset)/100);return `<td class="${result>=0?'positive':'negative'} ${costOffset===0&&revenueOffset===0?'current':''}">${esc(money(result))}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function renderSources() {
    const sourceName=data.meta.sourceFile||t('importedActuals');
    $('source-details').innerHTML=`<div class="fr-source-grid"><div><h3>${esc(t('financialSourceTitle'))}</h3><p>${esc(sourceName)}<br>${esc(periodLabel(data.meta.firstMonth,data.meta.lastMonth))} · P&amp;L</p><p>${esc(t('financialSourceText'))}</p></div><div><h3>${esc(t('operationalSourceTitle'))}</h3><p>${esc(t('operationalSourceText'))}</p><a href="https://docs.google.com/spreadsheets/d/1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg/edit" target="_blank" rel="noopener">${esc(t('openMastersheet'))} ↗</a></div><div><h3>${esc(t('presentationSourceTitle'))}</h3><p>September MBR – Oct 15.pptx<br>${esc(t('presentationSourceText'))}</p><a href="https://app.powerbi.com/groups/me/reports/d1fdf283-bdf6-4266-a414-ff7067db0a41/?pbi_source=PowerPoint" target="_blank" rel="noopener">Power BI ↗</a></div></div><dl class="fr-definition-list">${[['idleDays','idleDefinition'],['revenue','revenueFormula'],['profit','profitFormula'],['margin','marginFormula'],['returnOnCost','returnFormula'],['allocatedOverhead','allocationFormula'],['contributionProfit','contributionFormula'],['currency','currencyFormula']].map(([term,definition])=>`<dt>${esc(t(term))}</dt><dd>${esc(t(definition))}</dd>`).join('')}</dl>`;
    const issues=Array.isArray(data.reconciliation?.issues)?data.reconciliation.issues:[];
    $('reconciliation').innerHTML=issues.map((issue,index)=>`<div class="fr-reconciliation-item"><span>${String(index+1).padStart(2,'0')}</span><div><h3>${esc(localized(issue.title))}</h3><p>${esc(localized(issue.detail))}</p>${issue.source?`<p>${esc(t('sourceRange'))}: ${esc(issue.source.sheet||'')}!${esc(issue.source.range||'')}</p>`:''}</div></div>`).join('');
  }
  function renderOperations() {
    const context=t('lastMonthOps',{month:periodLabel(state.end,state.end)});
    const result=operationResult;
    let body=`<div class="fr-ops-status"><span class="fr-source-dot"></span><span>${esc(context)}<br>${esc(!result?t('loadingOps'):t({live:'opsLive',cache:'opsCache',stale:'opsStale',unverified:'opsUnverified',unavailable:'opsUnavailable'}[result.status]||'opsUnavailable'))}</span></div>`;
    if(result?.periodVerified && result.totals?.tkm!==null && result.totals?.kmDriven!==null) {
      const totals=result.totals,monthFinancial=aggregate(rowsFor(state.country,state.end,state.end));
      const metrics=[['tkm',n(totals.tkm)+' km'],['kmDriven',n(totals.kmDriven)+' km'],['efficiency',pct(totals.efficiency)],['costPerTkm',totals.tkm>0?money(monthFinancial.expenses/totals.tkm,true):'—']];
      body+=`<div class="fr-ops-values">${metrics.map(([key,value])=>`<div><div class="fr-ops-value">${esc(value)}</div><div class="fr-ops-label">${esc(t(key))}</div></div>`).join('')}</div>`;
    }
    body+=`<p class="fr-footnote">${esc(t('opsPeriodNote'))} ${esc(t('opsMixedNote'))}</p>`;
    if(result?.asOf)body+=`<p class="fr-footnote">${esc(t('opsRetrieved',{date:new Date(result.asOf).toLocaleString(locale())}))}</p>`;
    body+=`<a class="fr-text-btn fr-ops-link" href="dashboard.html">${esc(t('openDashboard'))} ↗</a>`;
    $('operations').innerHTML=body;
  }
  async function loadOperations(forceRefresh=false) {
    const key=`${data.meta.year}:${state.end}:${state.country}`;
    if(key===operationKey&&!forceRefresh)return;
    operationKey=key;operationResult=null;const sequence=++operationSequence;
    $('refresh-ops').disabled=true;renderOperations();
    try { const result=await window.FinancialOperations.load({month:state.end,year:data.meta.year,countryCode:state.country,forceRefresh});if(sequence!==operationSequence)return;operationResult=result; }
    catch(error){if(sequence!==operationSequence)return;operationResult={status:'unavailable'};console.warn('[Financial Report] Operations unavailable',error);}
    if(sequence===operationSequence){$('refresh-ops').disabled=false;renderOperations();}
  }
  function renderIdle() {
    const metricNames={idleDays:'idleDays',techDays:'idleTechnical',mechDays:'idleMechanical',weatherDays:'idleWeather'};
    document.querySelectorAll('[data-idle-range]').forEach(button=>button.classList.toggle('active',button.dataset.idleRange===idleRange));
    document.querySelectorAll('[data-idle-metric]').forEach(button=>button.classList.toggle('active',({technical:'techDays',mechanical:'mechDays',weather:'weatherDays',idleDays:'idleDays'}[button.dataset.idleMetric])===idleMetric));
    const start=idleRange==='ytd'?1:state.start;let result=idleResult;
    if(!result){$('idle-content').innerHTML=`<p class="fr-muted" role="status">${esc(t('idleLoading'))}</p>`;return;}
    if(!result.months?.length){$('idle-content').innerHTML=`<p class="fr-muted" role="status">${esc(t('idleUnavailable'))}</p>`;return;}
    const months=result.months.filter(row=>row.month>=start&&row.month<=state.end);
    const selected=state.country==='ALL'?codes:[state.country];
    const metrics=['idleDays','techDays','mechDays','weatherDays','mappingRecords','otherDownRecords','unclassifiedRecords','observedRecords','eligibleRecords','weekendRecords','holidayRecords'];
    const sumRows=rows=>Object.fromEntries(metrics.map(key=>{const values=rows.map(row=>row?.[key]).filter(Number.isFinite);return [key,values.length?values.reduce((a,b)=>a+b,0):null];}));
    const monthRows=months.map(month=>{const rows=selected.map(code=>month.countries?.find(row=>row.countryCode===code));return {...month,selected:rows,values:sumRows(rows)};});
    const total=sumRows(monthRows.flatMap(month=>month.selected));
    const partial=monthRows.some(month=>month.selected.some(row=>!row||row.coverage!=='recorded'));
    // Source freshness belongs to the visible period, independently of coverage.
    const statuses=new Set(months.map(month=>month.status));
    const sources=[...new Set(months.map(month=>month.source).filter(Boolean))];
    const status=!Number.isFinite(total.idleDays)?'unavailable':statuses.has('stale')?'stale':statuses.has('snapshot')?'snapshot':partial?'partial':statuses.has('live')?'live':'cache';
    result={...result,status,source:sources.length===1?sources[0]:sources.length?'mixed':null,
      asOf:months.map(month=>month.asOf).filter(Boolean).sort()[0]||null,
      dataThrough:months.map(month=>month.dataThrough).filter(Boolean).sort()[0]||null};
    const statusKey={live:'idleOnline',cache:'idleCached',stale:'idleStale',snapshot:'idleSnapshot',partial:'idlePartial',unavailable:'idleUnavailable'}[result.status]||'idlePartial';
    const max=Math.max(...monthRows.map(row=>row.values[idleMetric]||0),1);
    const coverage=rows=>rows.every(row=>row&&row.coverage==='recorded')?'idleRecorded':rows.some(row=>Number.isFinite(row?.idleDays))?'idlePartialCell':'idleMissingCell';
    const sourceName=(value,status)=>t({snapshot:'idleSnapshot',live:'idleOnline',cache:'idleCached',stale:'idleStale',partial:'idlePartial',unavailable:'idleUnavailable'}[status]||'idleUnavailable');
    const dateText=value=>value?new Date(String(value).length===10?value+'T12:00:00':value).toLocaleDateString(locale()):'—';
    $('idle-content').innerHTML=`<div class="fr-idle-meta"><span class="fr-tag">${esc(t('idlePeriod',{period:periodLabel(start,state.end),country:countryName(state.country)}))}</span><span>${esc(t(statusKey))}${partial&&statusKey!=='idlePartial'?' · '+esc(t('idlePartial')):''}</span></div><div class="fr-idle-kpis">${['idleDays','techDays','mechDays','weatherDays'].map(key=>`<div class="fr-idle-kpi"><span>${esc(t(metricNames[key]))}</span><strong>${n(total[key])}</strong><small>${esc(t('driverDays'))}</small></div>`).join('')}</div><p class="fr-footnote">${esc(t('idleDefinition'))}</p><p class="fr-footnote">${esc(t('idleOverlap'))}</p><div class="fr-idle-chart"><div class="fr-card-head"><h3>${esc(t('idleMonths'))} · ${esc(t(metricNames[idleMetric]))}</h3><span class="fr-tag">${esc(t('driverDays'))}</span></div>${monthRows.map(row=>`<div class="fr-idle-bar"><span>${esc(monthName(row.month,true))}</span><span class="fr-country-track"><i style="width:${(row.values[idleMetric]||0)/max*100}%"></i></span><strong>${n(row.values[idleMetric])}${coverage(row.selected)==='idlePartialCell'?'*':''}</strong></div>`).join('')}</div><h3 class="fr-subheading">${esc(t('idleCountries'))} · ${esc(t(metricNames[idleMetric]))}</h3><div class="fr-table-scroll"><table class="fr-table"><thead><tr><th>${esc(t('country'))}</th>${months.map(row=>`<th>${esc(monthName(row.month,true))}</th>`).join('')}<th>${esc(t('total'))}</th></tr></thead><tbody>${selected.map(code=>{const rows=monthRows.map(month=>month.countries?.find(row=>row.countryCode===code));return `<tr><td>${esc(countryName(code))}</td>${rows.map(row=>`<td title="${esc(t(!row||row.coverage==='missing'?'idleMissingCell':row.coverage==='partial'?'idlePartialCell':'idleRecorded'))}">${n(row?.[idleMetric])}${row?.coverage==='partial'?'*':''}</td>`).join('')}<td><strong>${n(sumRows(rows)[idleMetric])}${rows.some(row=>!row||row.coverage!=='recorded')?'*':''}</strong></td></tr>`;}).join('')}</tbody><tfoot><tr><td>${esc(t('total'))}</td>${monthRows.map(row=>`<td>${n(row.values[idleMetric])}${coverage(row.selected)!=='idleRecorded'?'*':''}</td>`).join('')}<td>${n(total[idleMetric])}${partial?'*':''}</td></tr></tfoot></table></div>${partial?`<p class="fr-footnote">* ${esc(t('idlePartial'))}</p>`:''}<div class="fr-idle-context">${[['idleObserved',n(total.observedRecords)],['idleEligibleRecords',n(total.eligibleRecords)],['idleWeekendRecords',n(total.weekendRecords)],['idleHolidayRecords',n(total.holidayRecords)],['idleMapping',n(total.mappingRecords)],['idleOtherDown',n(total.otherDownRecords)],['idleUnclassified',n(total.unclassifiedRecords)],['idleRate',pct(total.eligibleRecords>0?total.idleDays/total.eligibleRecords:null)]].map(([key,value])=>`<div><span>${esc(t(key))}</span><strong>${esc(value)}</strong></div>`).join('')}</div><p class="fr-footnote">${esc(t('idleRateFormula'))}</p><details class="fr-detail fr-spaced"><summary>${esc(t('idleCoverage'))}</summary><div class="fr-table-scroll"><table class="fr-table"><thead><tr>${['month','idleCoverage','sourceFile','idleObserved','idleUnclassified'].map(key=>`<th>${esc(t(key))}</th>`).join('')}</tr></thead><tbody>${monthRows.map(row=>`<tr><td>${esc(monthName(row.month))}</td><td>${esc(t(coverage(row.selected)))}</td><td>${esc(sourceName(row.source||result.source,row.status))}</td><td>${n(row.values.observedRecords)}</td><td>${n(row.values.unclassifiedRecords)}</td></tr>`).join('')}</tbody></table></div></details><p class="fr-footnote">${esc(t('idleExclusions'))}</p><p class="fr-footnote">${esc(t('idleNoCost'))}</p><p class="fr-footnote">${result.dataThrough?esc(t('idleThrough',{date:dateText(result.dataThrough)}))+' · ':''}${result.asOf?esc(t('opsRetrieved',{date:new Date(result.asOf).toLocaleString(locale())})):''}</p>`;
  }
  async function loadIdle(forceRefresh=false) {
    if(!data||!window.FinancialIdle)return;
    const key=`${data.meta.year}:${state.end}`;
    if(key===idleKey&&!forceRefresh)return;
    idleKey=key;idleResult=null;const sequence=++idleSequence;$('refresh-idle').disabled=true;renderIdle();
    try{const result=await window.FinancialIdle.load({year:data.meta.year,startMonth:1,endMonth:state.end,countryCode:'ALL',forceRefresh,onProgress:result=>{if(sequence===idleSequence){idleResult=result;renderIdle();}}});if(sequence!==idleSequence)return;idleResult=result;}
    catch(error){if(sequence!==idleSequence)return;idleResult={status:'unavailable'};console.warn('[Financial Report] Idle history unavailable',error);}
    if(sequence===idleSequence){$('refresh-idle').disabled=false;renderIdle();}
  }
  function setTab(tab,save=true) {
    state.tab=tabs.includes(tab)?tab:'opening';
    document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===state.tab);el.setAttribute('aria-current',el.dataset.tab===state.tab?'page':'false');});
    document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==state.tab);
    const index=tabs.indexOf(state.tab);$('presentation-position').textContent=t('presentationSection',{index:index+1,total:tabs.length});$('presentation-prev').disabled=index===0;$('presentation-next').disabled=index===tabs.length-1;
    if(state.tab==='idle')loadIdle();
    if(save)persistSettings();
  }
  function changeSelection() { fillFilters();render();persistSettings();loadOperations();if(idleResult||state.tab==='idle')loadIdle(); }
  function download(name,content,type) { const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function downloadCsv() {
    const headings=['countryCode','country','period','income','billables','managementFees','revenue','localExpenses','contributionProfit','allocatedOverhead','expenses','profit','margin','returnOnCost',...costKeys];
    const cell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
    const lines=rowsFor().map(row=>[row.countryCode,countryName(row.countryCode),row.period,...headings.slice(3,14).map(key=>row[key]),...costKeys.map(key=>row.costs[key])].map(cell).join(','));
    download(`latam-financial-${data.meta.year}-${state.start}-${state.end}-${state.country}.csv`,'\uFEFF'+headings.map(cell).join(',')+'\r\n'+lines.join('\r\n'),'text/csv;charset=utf-8');
  }
  function openCustomize() {
    $('custom-title').value=settings.title;$('margin-target').value=settings.target;$('display-unit').value=settings.unit;$('comment-title').value=settings.commentTitle;$('comment-text').value=settings.commentText;
    $('customize-dialog').showModal();
  }
  async function importFinancial(file) {
    if(!file)return;
    try {
      if(file.size>2500000)throw new Error('size');
      const next=validateData(JSON.parse(await file.text()));
      // Only store after all validation succeeds; do not overwrite a working report on failure.
      localStorage.setItem(storageKey('DATA'),JSON.stringify(next));
      data=next;imported=true;state.start=state.end=data.meta.lastMonth;operationKey='';changeSelection();toast(t('dataImported'));
    }catch(error){console.warn('[Financial Report] Import rejected',error.message);toast(t(error.name==='QuotaExceededError'?'storageUnavailable':'invalidData'));}
  }
  function wireEvents() {
    document.querySelectorAll('[data-lang]').forEach(button=>button.addEventListener('click',()=>{lang=button.dataset.lang;try{localStorage.setItem('latam.lang',lang);}catch(error){}applyLanguage();}));
    $('country-filter').addEventListener('change',event=>{state.country=event.target.value;changeSelection();});
    $('start-filter').addEventListener('change',event=>{state.start=Number(event.target.value);if(state.start>state.end)state.end=state.start;changeSelection();});
    $('end-filter').addEventListener('change',event=>{state.end=Number(event.target.value);if(state.end<state.start)state.start=state.end;changeSelection();});
    $('ytd-btn').addEventListener('click',()=>{state.start=1;changeSelection();});
    $('mbr-btn').addEventListener('click',()=>{state.start=state.end=9;state.country='ALL';state.tab='opening';changeSelection();});
    $('latest-btn').addEventListener('click',()=>{state.start=state.end=data.meta.lastMonth;changeSelection();});
    document.addEventListener('click',event=>{
      const tab=event.target.closest('[data-tab],[data-go]');if(tab)setTab(tab.dataset.tab||tab.dataset.go);
      const country=event.target.closest('[data-country]');if(country){state.country=country.dataset.country;changeSelection();}
      const month=event.target.closest('[data-month]');if(month){state.start=state.end=Number(month.dataset.month);changeSelection();}
    });
    $('trend-chart').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.hasAttribute('data-month')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
    $('refresh-ops').addEventListener('click',()=>loadOperations(true));
    $('refresh-idle').addEventListener('click',()=>loadIdle(true));
    $('monthly-metric').addEventListener('change',renderMbr);
    $('idle-range').addEventListener('click',event=>{const button=event.target.closest('[data-idle-range]');if(button){idleRange=button.dataset.idleRange;renderIdle();}});
    $('idle-metric').addEventListener('click',event=>{const button=event.target.closest('[data-idle-metric]');if(button){idleMetric={technical:'techDays',mechanical:'mechDays',weather:'weatherDays',idleDays:'idleDays'}[button.dataset.idleMetric];renderIdle();}});
    $('customize-btn').addEventListener('click',openCustomize);$('close-customize').addEventListener('click',()=>$('customize-dialog').close());
    $('customize-dialog').addEventListener('click',event=>{if(event.target===$('customize-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
    $('customize-form').addEventListener('submit',event=>{event.preventDefault();settings=sanitizeSettings({...settings,title:$('custom-title').value,target:Number($('margin-target').value),unit:$('display-unit').value,commentTitle:$('comment-title').value,commentText:$('comment-text').value});const saved=persistSettings();$('customize-dialog').close();render();if(saved)toast(t('settingsSaved'));});
    $('present-btn').addEventListener('click',()=>{document.body.classList.add('fr-present');$('exit-present').hidden=false;$('presentation-nav').hidden=false;setTab('opening');window.scrollTo({top:0,behavior:'smooth'});loadIdle();});
    function exitPresent(){document.body.classList.remove('fr-present','fr-present-filters');$('presentation-filters').setAttribute('aria-expanded','false');$('exit-present').hidden=true;$('presentation-nav').hidden=true;}
    function presentationStep(direction){const index=tabs.indexOf(state.tab),next=index+direction;if(next>=0&&next<tabs.length){setTab(tabs[next]);window.scrollTo({top:0,behavior:'smooth'});}}
    $('presentation-filters').addEventListener('click',()=>{const visible=document.body.classList.toggle('fr-present-filters');$('presentation-filters').setAttribute('aria-expanded',String(visible));});
    $('presentation-prev').addEventListener('click',()=>presentationStep(-1));$('presentation-next').addEventListener('click',()=>presentationStep(1));
    document.addEventListener('keydown',event=>{if(document.body.classList.contains('fr-present')&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName)&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();presentationStep(event.key==='ArrowRight'?1:-1);}});
    $('exit-present').addEventListener('click',exitPresent);document.addEventListener('keydown',event=>{if(event.key==='Escape')exitPresent();});
    $('print-btn').addEventListener('click',()=>window.print());$('csv-btn').addEventListener('click',downloadCsv);
    ['revenue-change','cost-change','horizon'].forEach(id=>$(id).addEventListener('input',event=>{settings[{'revenue-change':'revenueChange','cost-change':'costChange',horizon:'horizon'}[id]]=Number(event.target.value);renderScenario();persistSettings();}));
    $('scenario-reset').addEventListener('click',()=>{settings.revenueChange=0;settings.costChange=0;settings.horizon=3;renderScenario();persistSettings();});
    $('download-data').addEventListener('click',()=>download('latam-financial-data.json',JSON.stringify(data,null,2),'application/json'));
    $('import-data').addEventListener('change',event=>{importFinancial(event.target.files[0]);event.target.value='';});
    $('restore-data').addEventListener('click',()=>{try{localStorage.removeItem(storageKey('DATA'));}catch(error){toast(t('storageUnavailable'));return;}data=sourceData;imported=false;state.start=state.end=data.meta.lastMonth;operationKey='';changeSelection();toast(t('dataRestored'));});
    $('export-settings').addEventListener('click',()=>{if(!$('customize-form').reportValidity())return;const edited=sanitizeSettings({...settings,title:$('custom-title').value,target:Number($('margin-target').value),unit:$('display-unit').value,commentTitle:$('comment-title').value,commentText:$('comment-text').value});download('latam-financial-settings.json',JSON.stringify({schemaVersion:1,settings:edited,state},null,2),'application/json');});
    $('import-settings').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>100000)throw new Error('size');const payload=JSON.parse(await file.text());if(payload.schemaVersion!==1)throw new Error('schema');const nextSettings=sanitizeSettings(payload.settings);let nextState={...state};if(payload.state){const proposed=payload.state;if(!Number.isInteger(proposed.start)||!Number.isInteger(proposed.end)||proposed.start<1||proposed.end>12||proposed.start>proposed.end||!['ALL',...codes].includes(proposed.country)||!tabs.includes(proposed.tab))throw new Error('state');nextState={country:proposed.country,start:proposed.start,end:proposed.end,tab:proposed.tab};}settings=nextSettings;state=nextState;fillFilters();const saved=persistSettings();$('customize-dialog').close();changeSelection();if(saved)toast(t('settingsImported'));}catch(error){toast(t('invalidSettings'));}});
  }
  async function startApp(loginUser) {
    user=loginUser;
    try {const saved=JSON.parse(localStorage.getItem(storageKey('SETTINGS'))||'null');if(saved){settings=sanitizeSettings(saved.settings);state={...state,...saved.state};}}catch(error){console.warn('[Financial Report] Saved settings ignored');}
    $('app-content').hidden=false;applyLanguage();wireEvents();
    try {
      const response=await fetch('Financial%20Reports/financial-data.json?v=20261020');if(!response.ok)throw new Error('HTTP '+response.status);
      sourceData=validateData(await response.json());data=sourceData;
      try{const saved=localStorage.getItem(storageKey('DATA'));if(saved){data=validateData(JSON.parse(saved));imported=true;}}catch(error){console.warn('[Financial Report] Saved financial data ignored',error.message);}
      if(!readStorage(storageKey('SETTINGS')))state.start=state.end=data.meta.lastMonth;
      fillFilters();$('load-state').hidden=true;$('report-content').hidden=false;render();loadOperations();loadIdle();
    }catch(error){console.error('[Financial Report] Could not load financial data',error);$('load-state').innerHTML=`<p>${esc(t('loadError'))}</p><button type="button" class="fr-btn" id="retry-data">${esc(t('retry'))}</button>`;$('retry-data').addEventListener('click',()=>location.reload());}
  }
  document.addEventListener('DOMContentLoaded',()=>injectLogin({title:'Financial Report',sub:t('internal'),lang,adminGate:true,onSuccess:startApp}));
})();
