const fs=require('node:fs');
const path=require('node:path');
const mammoth=require('mammoth');
const sanitize=require('sanitize-html');
const cheerio=require('cheerio');
const {Document,Packer,Paragraph,TextRun,HeadingLevel,PageBreak,ExternalHyperlink}=require('docx');
function checkWordArchive(file){return new Promise((resolve,reject)=>{require('yauzl').open(file,{lazyEntries:true},(error,zip)=>{if(error){reject(new Error('Word 文档不是有效 DOCX'));return;}let count=0,total=0,done=false;const fail=e=>{if(done)return;done=true;zip.close();reject(e)};zip.on('error',fail);zip.on('entry',entry=>{total+=entry.uncompressedSize;if(++count>10000||total>256*1024*1024||entry.uncompressedSize>64*1024*1024){fail(new Error('Word 解压内容过大，请拆分资料'));return;}zip.readEntry()});zip.on('end',()=>{if(!done){done=true;resolve()}});zip.readEntry()})});}
function cleanHtml(html){return sanitize(html,{allowedTags:['p','h1','h2','h3','h4','h5','h6','strong','em','u','s','del','br','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','td','th','img','a','sup','sub','hr'],allowedAttributes:{'*':['id'],'a':['href'],'img':['src','alt'],'td':['colspan','rowspan'],'th':['colspan','rowspan'],'ol':['start']},allowedSchemes:['http','https','mailto'],allowedSchemesByTag:{img:['data']},allowProtocolRelative:false,transformTags:{img:(tag,attrs)=>({tagName:'img',attribs:/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(attrs.src||'')?{src:attrs.src,alt:attrs.alt||''}:{alt:'不支持的图片，请查看原件'}})}});}
async function parseDocument(file,onProgress=()=>{}){
 const kind=path.extname(file).slice(1).toLowerCase();if(!['docx','pdf'].includes(kind))throw new Error('仅支持 .docx 和 .pdf；旧 .doc 请先另存为 .docx');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size<1||stat.size>512*1024*1024)throw new Error('文档为空或超过 512 MB');
 const bytes=fs.readFileSync(file),title=path.basename(file,path.extname(file)).slice(0,500),warnings=[];onProgress({phase:'解析资料',done:0,total:1});
 if(kind==='docx'){
  await checkWordArchive(file);
  // No embedded style maps, external file access, or remote image requests.
  const result=await mammoth.convertToHtml({buffer:bytes},{includeEmbeddedStyleMap:false,externalFileAccess:false});
  const $=cheerio.load(cleanHtml(result.value),null,false),outline=[];$('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre').each((i,el)=>{$(el).attr('id','b'+i);if(/^h[1-6]$/.test(el.tagName))outline.push({title:$(el).text(),block:'b'+i,page:1});});
  warnings.push('Word 已按内容重新排版；页眉页脚、修订批注和复杂布局请在原件中查看。',...result.messages.map(m=>m.message));
  const html=cleanHtml($.html());if(html.length>32_000_000||$.text().length>32_000_000)throw new Error('转换后的 Word 内容超过 32 MB，请拆分文档');
  return {bytes,parsed:{kind,title,html,pages:[$.text()],pageCount:1,outline,warnings}};
 }
 if(bytes.subarray(0,1024).indexOf('%PDF-')<0)throw new Error('PDF 文档格式无效');
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const root=path.dirname(require.resolve('pdfjs-dist/package.json'));
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,cMapUrl:path.join(root,'cmaps').replaceAll('\\','/')+'/',cMapPacked:true,standardFontDataUrl:path.join(root,'standard_fonts').replaceAll('\\','/')+'/',wasmUrl:path.join(root,'wasm').replaceAll('\\','/')+'/'});
 try{
  const pdf=await task.promise,pages=[],outline=[];let totalChars=0;
  for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();const t=content.items.map(x=>x.str===undefined?'':x.str+(x.hasEOL?'\n':' ')).join('');totalChars+=t.length;if(totalChars>32_000_000)throw new Error('PDF 可检索文字超过 32 MB，请拆分资料');pages.push(t);page.cleanup();onProgress({phase:'提取 PDF 文字',done:i,total:pdf.numPages});}
  const walk=async nodes=>{for(const n of nodes||[]){let page=1;try{const dest=typeof n.dest==='string'?await pdf.getDestination(n.dest):n.dest;if(dest)page=(typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]))+1;}catch{}outline.push({title:n.title,page});await walk(n.items);}};await walk(await pdf.getOutline());
  if(pages.every(p=>!p.trim()))warnings.push('此 PDF 没有可提取的文字层，可阅读并写页级心得；暂不支持 OCR。');
  return {bytes,parsed:{kind,title,pages,pageCount:pdf.numPages,outline,warnings}};
 }catch(e){throw new Error('PDF 无法读取（可能已加密或损坏）：'+e.message);}finally{await task.destroy();}
}
function wordParagraphs(doc){
 const inline=n=>{
  if(n.type==='hardBreak')return [new TextRun({break:1})];
  if(n.type==='text'){const marks=n.marks||[],r=new TextRun({text:n.text,bold:marks.some(m=>m.type==='bold'),italics:marks.some(m=>m.type==='italic'),strike:marks.some(m=>m.type==='strike'),underline:marks.some(m=>m.type==='underline')?{}:undefined,font:marks.some(m=>m.type==='code')?'Consolas':undefined});const link=marks.find(m=>m.type==='link');return link&&/^(https?:|mailto:)/.test(link.attrs?.href||'')?[new ExternalHyperlink({link:link.attrs.href,children:[r]})]:[r];}
  return (n.content||[]).flatMap(inline);
 };
 const walk=(n,depth=0,prefix='',quoted=false)=>{
  if(n.type==='bookPageBreak')return [new Paragraph({children:[new PageBreak()]})];
  if(n.type==='bulletList'||n.type==='orderedList')return (n.content||[]).flatMap((v,i)=>walk(v,depth+1,n.type==='bulletList'?'• ':`${(n.attrs?.start||1)+i}. `,quoted));
  if(n.type==='blockquote')return (n.content||[]).flatMap(v=>walk(v,depth+1,'',true));
  if(['paragraph','heading','codeBlock','horizontalRule'].includes(n.type))return [new Paragraph({children:[...(prefix?[new TextRun(prefix)]:[]),...inline(n)],style:quoted?'ReadingQuote':undefined,keepNext:n.type==='heading',heading:n.type==='heading'?HeadingLevel['HEADING_'+n.attrs.level]:undefined,indent:depth?{left:depth*240}:undefined,spacing:{after:160,line:360},...(n.type==='horizontalRule'?{border:{bottom:{style:'single',size:2,color:'888888'}}}:{})})];
  return (n.content||[]).flatMap(v=>walk(v,depth,prefix,quoted));
 };return walk(doc);
}
async function exportWord(store,input){
 let title,doc;if(input.noteId){const n=store.run('snapshot').notes.find(n=>n.id===input.noteId);if(!n)throw new Error('笔记不存在');title=n.title||'未命名笔记';doc=n.doc;}else{
  const {excerptBlocks,compareAnnotations}=require('./reading.cjs'),d=store.reading.get(input.documentId);title=d.title+' · 摘录与想法';doc={type:'doc',content:store.reading.annotations(d.id).sort(compareAnnotations).flatMap(a=>excerptBlocks(d,a))};
 }
 const font={ascii:'Calibri',hAnsi:'Calibri',eastAsia:'Microsoft YaHei',cs:'Calibri'};
 const document=new Document({creator:'BlockNotes',title,styles:{default:{document:{run:{font,size:22,language:{val:'zh-CN',eastAsia:'zh-CN'}},paragraph:{spacing:{after:160,line:360}}},title:{run:{font,size:36,bold:true,color:'222222'},paragraph:{spacing:{after:320},keepNext:true}},heading1:{run:{font,size:30,bold:true,color:'222222'}},heading2:{run:{font,size:26,bold:true,color:'222222'}},heading3:{run:{font,size:24,bold:true,color:'222222'}}},paragraphStyles:[{id:'ReadingQuote',name:'原文摘录',basedOn:'Normal',run:{color:'555555'},paragraph:{indent:{left:360,right:240},border:{left:{style:'single',size:12,color:'B2A17A',space:8}},spacing:{before:120,after:120}}}]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},children:[new Paragraph({text:title,heading:HeadingLevel.TITLE}),...wordParagraphs(doc)]}]});
 const bytes=await Packer.toBuffer(document),tmp=input.file+'.'+require('node:crypto').randomUUID()+'.tmp';try{fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,input.file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}return {filePath:input.file};
}
module.exports={parseDocument,cleanHtml,exportWord};
