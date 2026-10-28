'use strict';
(() => {
  const entries = [
    ['钱学森的毕业课题','qian-xuesen-graduation-project.html','钱学森 轨道 火箭 Java 地月 日地月 太阳 三圈 自由返回'],
    ['地月自由返回·经典版','qian-xuesen-earth-moon-classic.html','钱学森 地球 月球 CR3BP 自由返回 经典'],
    ['日地月三圈任务·动力版','qian-xuesen-solar-three-orbits.html','钱学森 太阳 地球 月球 绕月 三圈 推力 燃料 Java'],
    ['沟槽反光模拟','concentric_and_straight_groove_imaging.html','光学 物理 同心圆 直线 沟槽 反光 成像 模拟 可视化'],
    ['理论物理与数学','research.html','研究 课题 进展 手记 数学 物理 论文 讲义 成果'],
    ['趣味实验室','play.html','游戏 小发明 玩具 互动 可视化'],
    ['俄罗斯方块 Tetris','tetris.html','游戏 方块 旋转 消行'],
    ['数独求解器','sudoku.html','数独 sudoku 检查 求解'],
    ['三维数独','3d-sudoku.html','三维 3d 数独 切片 原型'],
    ['二维魔方求解器','rubiks-cube.html','魔方 cube 二维 2d 求解'],
    ['三维魔方','rubiks-cube-3d.html','魔方 cube 三维 3d 动画 复原'],
    ['滑翔伞 · 飞行影像','flight.html','飞行 滑翔伞 paragliding 照片 视频 影像 日志'],
    ['小程序工坊','apps.html','小程序 应用 app 开发 工具'],
    ['比特币网络共识实验','bitcoin-consensus.html','bitcoin 比特币 共识 网络 分叉 链重组 Python simulation 模拟 白皮书'],
    ['加密货币探索','crypto.html','crypto cryptocurrency 加密货币 代币 构想'],
    ['札记与书架','notes.html','读书 阅读 书架 随想 笔记 问题'],
    ['关于我与这里','about.html','Thomas Young 关于 联系 GitHub'],
    ['全站目录','archive.html','目录 索引 全部']
  ];
  const toggle = document.getElementById('search-toggle');
  const search = document.getElementById('site-search');
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  function showResults() {
    const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    results.replaceChildren();
    if (!terms.length) { document.getElementById('search-count').textContent = '输入关键词查找栏目与作品。研究文章和飞行影像将在收录后加入索引。'; return; }
    const found = entries.filter(e => terms.every(t => `${e[0]} ${e[2]}`.toLocaleLowerCase().includes(t)));
    document.getElementById('search-count').textContent = found.length ? `找到 ${found.length} 个入口` : '暂未找到相关入口，请换一个关键词。';
    found.forEach(([title,url,desc])=>{
      const li=document.createElement('li'), a=document.createElement('a'), small=document.createElement('small');
      a.href=url; a.textContent=title; small.textContent=desc; li.append(a,small); results.append(li);
    });
  }
  if(toggle && search && input){
    toggle.addEventListener('click',()=>{search.hidden=!search.hidden;toggle.setAttribute('aria-expanded',String(!search.hidden));if(!search.hidden){showResults();input.focus();}});
    input.addEventListener('input',showResults);
    search.addEventListener('keydown',e=>{if(e.key==='Escape'){search.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
  }
  document.querySelectorAll('[data-project-filter]').forEach(button=>{
    button.addEventListener('click',()=>{
      const category=button.dataset.projectFilter;
      document.querySelectorAll('[data-project-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      let count=0;
      document.querySelectorAll('[data-project-category]').forEach(project=>{project.hidden=category!=='全部'&&project.dataset.projectCategory!==category;if(!project.hidden)count++;});
      document.getElementById('project-count').textContent=`${count} 个作品`;
    });
  });
  const gallery=document.getElementById('media-gallery');
  if(!gallery) return;
  let media=[], selected='all', failed=false;
  const empty=document.getElementById('media-empty');
  const modal=document.getElementById('media-modal');
  // Only authored local assets and HTTPS media can be used as media sources.
  function safeSource(value){
    if(typeof value!=='string'||!value.trim())return null;
    try {const u=new URL(value,document.baseURI);return u.protocol==='https:'||u.origin===location.origin&&['http:','file:'].includes(u.protocol)?u.href:null;}catch{return null;}
  }
  function render(){
    gallery.replaceChildren();
    const list=media.filter(m=>selected==='all'||m.type===selected);
    document.getElementById('media-count').textContent=failed?'影像目录暂时无法加载':`${list.length} ${selected==='photo'?'张照片':selected==='video'?'段视频':'条影像记录'}`;
    empty.hidden=list.length>0;
    document.getElementById('media-empty-title').textContent=failed?'影像目录暂时无法加载':media.length?'这个分类还没有记录':'等待第一段飞行记录';
    document.getElementById('media-empty-copy').textContent=failed?'请稍后刷新再试。':media.length?'可以切换到其他分类查看。':'目前还没有公开的照片或视频。未来会按实际拍摄日期归档，照片可以放大查看，视频可以直接播放。';
    list.forEach(item=>{
      const article=document.createElement('article'),figure=document.createElement('figure'),caption=document.createElement('figcaption'),meta=document.createElement('small');
      article.className='media-item';caption.textContent=item.title||'飞行记录';
      const details=[item.date,item.location,item.caption].filter(v=>typeof v==='string'&&v.trim());meta.textContent=details.join(' · ');
      if(item.type==='photo'){
        const img=document.createElement('img'),button=document.createElement('button');img.src=safeSource(item.src);img.alt=item.alt||item.title||'滑翔伞照片';img.loading='lazy';button.type='button';button.setAttribute('aria-label',`放大查看：${item.title||'飞行照片'}`);button.append(img);
        button.addEventListener('click',()=>{document.getElementById('media-large').src=img.src;document.getElementById('media-large').alt=img.alt;document.getElementById('media-caption').textContent=[item.title,...details].filter(Boolean).join(' · ');modal.showModal();});figure.append(button);
      }else{
        const video=document.createElement('video');video.src=safeSource(item.src);video.controls=true;video.preload='metadata';video.playsInline=true;video.setAttribute('aria-label',item.title||'滑翔伞视频');const poster=safeSource(item.poster);if(poster)video.poster=poster;
        const link=document.createElement('a');link.href=video.src;link.textContent='打开视频文件';video.append(link);figure.append(video);
      }
      figure.append(caption,meta);article.append(figure);gallery.append(article);
    });
  }
  document.querySelectorAll('[data-media-filter]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.mediaFilter;document.querySelectorAll('[data-media-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
  document.getElementById('media-close').addEventListener('click',()=>modal.close());
  modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});
  fetch('flight-media.json').then(response=>{if(!response.ok)throw Error('media index');return response.json();}).then(data=>{
    if(!Array.isArray(data))throw Error('media format');
    media=data.filter(m=>m&&['photo','video'].includes(m.type)&&safeSource(m.src)).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));render();
  }).catch(()=>{failed=true;render();});
})();


