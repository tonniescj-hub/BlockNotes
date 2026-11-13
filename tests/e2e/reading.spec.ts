import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {Document,Packer,Paragraph,TextRun,HeadingLevel} from 'docx'
import electronPath from 'electron'
import {pdfFixture} from '../reading-fixtures.mjs'
const require=createRequire(import.meta.url)
let app:ElectronApplication|undefined,dir:string
test.beforeEach(()=>{dir=mkdtempSync(path.join(tmpdir(),'blocknotes-reading-e2e-'));if(process.env.BLOCKNOTES_TEST_RESOURCE_PACK){const {validatePack,recipe}=require('../../server/resources.cjs'),root=path.resolve(process.env.BLOCKNOTES_TEST_RESOURCE_PACK);if(!validatePack(root))throw new Error('测试资源校验失败');const packs=path.join(dir,'resource-packs');mkdirSync(packs);symlinkSync(root,path.join(packs,'minecraft-1.21-test'),'junction');writeFileSync(path.join(packs,'active.json'),JSON.stringify({recipe,directory:'minecraft-1.21-test'}))}})
test.afterEach(async()=>{await app?.close();app=undefined;if(path.dirname(dir)===path.resolve(tmpdir())&&path.basename(dir).startsWith('blocknotes-reading-e2e-'))rmSync(dir,{recursive:true,force:true})})
test('Word import → highlight and thought → note → Word export; close saves pending thought',async()=>{
 const source=path.join(dir,'中文学习资料.docx');writeFileSync(source,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({text:'第一章 学习方法',heading:HeadingLevel.HEADING_1}),new Paragraph({children:[new TextRun({text:'学习需要主动思考，摘录需要保留出处。',bold:true})]})]}]})))
 const env={...process.env,BLOCKNOTES_DATA_DIR:dir};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:process.env.BLOCKNOTES_TEST_EXE||electronPath as unknown as string,args:process.env.BLOCKNOTES_TEST_EXE?[]:['.'],env});const page=await app.firstWindow()
 await expect(page.locator('.world')).toHaveAttribute('data-ready','true')
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]})},source)
 await page.keyboard.press('4');await page.getByRole('button',{name:'导入 Word / PDF',exact:true}).click()
 await expect(page.locator('.word-reading-page')).toContainText('学习需要主动思考')
 await page.locator('.word-reading-page p').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection()!;s.removeAllRanges();s.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})
 await expect(page.getByRole('textbox',{name:'摘录想法'})).toBeVisible()
 await page.getByRole('textbox',{name:'摘录想法'}).fill('自己的理解：主动联系旧知识。')
 await page.getByRole('button',{name:'保存摘录与想法',exact:true}).click()
 await expect(page.locator('.annotation-card')).toHaveCount(1)
 await page.getByRole('button',{name:'加入笔记',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'书与笔编辑',exact:true})).toBeVisible()
 await expect(page.locator('.tiptap')).toContainText('出处：中文学习资料')
 await expect(page.locator('.tiptap')).toContainText('自己的理解')
 await page.getByRole('button',{name:'书名与标签…',exact:true}).click()
 const output=path.join(dir,'读书心得.docx');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output})},output)
 await page.getByRole('button',{name:'导出 Word',exact:true}).click();await expect(page.locator('.toast')).toContainText('Word 文档已导出')
 const text=await require('mammoth').extractRawText({path:output});expect(text.value).toContain('主动联系旧知识');expect(text.value).toContain('出处：中文学习资料')
 await page.getByRole('button',{name:'查看原文：中文学习资料',exact:true}).click()
 await expect(page.locator('.word-reading-page')).toBeVisible()
 await page.getByRole('button',{name:'摘录',exact:true}).click();await page.locator('.annotation-card').click()
 await app.evaluate(({ipcMain})=>{const original=(ipcMain as any)._invokeHandlers.get('blocknotes:command');ipcMain.removeHandler('blocknotes:command');ipcMain.handle('blocknotes:command',async(e,op,input)=>{if(op==='reading.annotate')await new Promise(r=>setTimeout(r,400));return original(e,op,input)})});await page.getByRole('textbox',{name:'摘录想法'}).fill('保存过程中仍可继续输入')
 await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'摘录想法'}).fill('Esc 自动可靠保存这次修改');await expect(page.getByRole('dialog')).toHaveCount(0)
 const snapshot=await page.evaluate(()=>(window as any).blocknotes.call('snapshot'));const detail=await page.evaluate(id=>(window as any).blocknotes.call('reading.get',{id}),snapshot.documents[0].id);expect(detail.annotations[0].comment).toBe('Esc 自动可靠保存这次修改')
 await page.keyboard.press('5');await expect(page.locator('.word-reading-page')).toBeVisible()
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,640))
 await page.screenshot({path:'test-results/reading-word-small.png'})
 const bounds=await page.locator('.document-reading-area').boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(800)
})
test('batch excerpts and long note return preserve reading position and editor page',async()=>{
 const source=path.join(dir,'长篇学习.docx');writeFileSync(source,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({text:'第一章',heading:HeadingLevel.HEADING_1}),...Array.from({length:80},(_,i)=>new Paragraph('学习段落 '+i+'：阅读与思考。'.repeat(8)))]}]})));
 const {readingFileTask}=require('../../server/reading-file.cjs'),{openStore}=require('../../server/storage.cjs');const {document:d}=await readingFileTask('import',dir,{file:source});const store=openStore(dir,{dailyBackup:false});
 for(const [quote,start] of [['第一条摘录',1],['第二条摘录',10]] as const)store.run('reading.annotate',{documentId:d.id,quote,comment:'自己的想法',anchor:{page:1,block:'b1',start,end:start+6,rects:[]}});
 const n=store.run('create',{title:'已有长笔记',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'第一页旧内容'}]},{type:'bookPageBreak'},{type:'paragraph',content:[{type:'text',text:'第二页旧内容'}]},{type:'bookPageBreak'},{type:'paragraph',content:[{type:'text',text:'第三页旧内容'}]}]}});store.close();
 const env={...process.env,BLOCKNOTES_DATA_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:process.env.BLOCKNOTES_TEST_EXE||electronPath as unknown as string,args:process.env.BLOCKNOTES_TEST_EXE?[]:['.'],env});const page=await app.firstWindow();await expect(page.locator('.world')).toHaveAttribute('data-ready','true');
 await page.keyboard.press('4');await page.getByRole('button',{name:'长篇学习',exact:false}).first().click();await expect(page.locator('.word-reading-page')).toBeVisible();
 await page.locator('.document-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight*.5});await page.getByRole('button',{name:'摘录',exact:true}).click();
 await page.getByRole('checkbox',{name:'选择摘录 1',exact:true}).check();await page.getByRole('checkbox',{name:'选择摘录 2',exact:true}).check();await page.getByRole('combobox',{name:'批量摘录加入笔记'}).selectOption(n.id);expect(await page.locator('.annotation-list').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await expect(page.locator('.annotation-card').first()).toBeInViewport();await page.screenshot({path:'test-results/reading-batch-021.png'});await page.getByRole('button',{name:'加入笔记（2）',exact:true}).click();
 await expect(page.locator('.tiptap')).toContainText('第一条摘录');await expect(page.locator('.tiptap')).toContainText('第二条摘录');
 await page.locator('.tiptap').focus();await page.keyboard.press('Control+Home');await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.page-heading')).toContainText('第 2 页');
 await page.keyboard.type('新增心得');await page.screenshot({path:'test-results/reading-note-021.png'});await page.getByRole('button',{name:'返回阅读',exact:true}).click();await expect(page.locator('.word-reading-page')).toBeVisible();
 await expect.poll(()=>page.locator('.document-scroll').evaluate(el=>el.scrollTop)).toBeGreaterThan(500);
 await page.getByRole('button',{name:'选书',exact:true}).click();await page.locator('.lectern-note[aria-current="true"]').click();await expect(page.getByRole('button',{name:'继续笔记',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'继续笔记',exact:true}).click();await expect(page.locator('.page-heading')).toContainText('第 2 页');await expect(page.locator('.tiptap')).toContainText('新增心得');
 const output=path.join(dir,'批量心得.docx');await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output})},output);await page.getByRole('button',{name:'导出 Word',exact:true}).click();await expect(page.locator('.toast')).toContainText('Word 文档已导出');
 const text=await require('mammoth').extractRawText({path:output});expect(text.value).toContain('第一条摘录');expect(text.value).toContain('新增心得');expect(text.value).toContain('第一章');
});

test('PDF retains pages, selectable text, highlights, zoom and reading position',async()=>{
 const source=path.join(dir,'阅读资料.pdf');writeFileSync(source,pdfFixture());const {readingFileTask}=require('../../server/reading-file.cjs');const {document:d}=await readingFileTask('import',dir,{file:source});
 const env={...process.env,BLOCKNOTES_DATA_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:process.env.BLOCKNOTES_TEST_EXE||electronPath as unknown as string,args:process.env.BLOCKNOTES_TEST_EXE?[]:['.'],env});const page=await app.firstWindow();await expect(page.locator('.world')).toHaveAttribute('data-ready','true');
 await page.keyboard.press('5');await expect(page.locator('.reading-pdf-page .textLayer')).toContainText('Reading material one');
 await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.reading-pdf-page .textLayer')).toContainText('Reading material two');
 await page.locator('.reading-pdf-page .textLayer span').first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection()!;s.removeAllRanges();s.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
 await page.getByRole('button',{name:'划线保存',exact:true}).click();await expect(page.locator('.pdf-excerpt-highlight').first()).toBeVisible();
 await page.getByRole('combobox',{name:'PDF 缩放'}).selectOption('1.5');await expect(page.locator('.reading-pdf-page .textLayer')).toContainText('Reading material two');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.keyboard.press('5');await expect(page.getByRole('spinbutton',{name:'PDF 页码'})).toHaveValue('2');
 await expect(page.locator('.reading-pdf-page')).toHaveAttribute('data-ready','true');await expect(page.locator('.reading-pdf-page .textLayer')).toContainText('Reading material two');await page.screenshot({path:'test-results/reading-pdf.png'});
 const detail=await page.evaluate(id=>(window as any).blocknotes.call('reading.get',{id}),d.id);expect(detail.annotations[0].anchor.page).toBe(2);expect(detail.annotations[0].anchor.rects.length).toBeGreaterThan(0);
})
