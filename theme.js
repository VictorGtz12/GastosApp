// Shared palette for Gastos and Recordatorios. Applied before first paint.
function uiApplyTheme(mode) {
  const palette = mode === 'claro' ? {
    bg:'#f5f5f9',bg2:'#ffffff',bg3:'#ededf4',text:'#222331',text2:'#55576b',text3:'#66697e',border:'#2223310c',border2:'#22233119',accent:'#6856ce',accent2:'#6856ce',green:'#187b61',red:'#b83652',orange:'#946119',purple:'#6856ce',yellow:'#946119'
  } : mode === 'revolut' ? {
    bg:'#08090d',bg2:'#14151b',bg3:'#20212b',text:'#f5f5fa',text2:'#c0c2d2',text3:'#9699b0',border:'#ffffff0d',border2:'#ffffff1c',accent:'#7664e2',accent2:'#b9adff',green:'#61d5b0',red:'#ff899a',orange:'#edba72',purple:'#b9adff',yellow:'#e6ca85'
  } : {
    bg:'#101116',bg2:'#191b23',bg3:'#222530',text:'#f4f3fa',text2:'#bbbccf',text3:'#9497ad',border:'#ffffff0d',border2:'#ffffff1c',accent:'#7664e2',accent2:'#b6aaff',green:'#61d5b0',red:'#ff899a',orange:'#edba72',purple:'#b6aaff',yellow:'#e6ca85'
  };
  for (const [key,value] of Object.entries(palette)) document.documentElement.style.setProperty('--'+key,value);
  document.documentElement.dataset.theme=mode;
  if(document.body) document.body.style.background=palette.bg;
  const meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.content=palette.bg;
}

uiApplyTheme(localStorage.getItem('tema') || 'oscuro');
