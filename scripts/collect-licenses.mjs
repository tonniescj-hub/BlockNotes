// Preserve licenses of the production dependency tree used by the renderer bundle.
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
const visited=new Set(),entries=[],out='docs/licenses'
fs.mkdirSync(out,{recursive:true})
const retain=(file,text)=>fs.writeFileSync(file,text.split(/\r?\n/).map(line=>line.trimEnd()).join('\n').trimEnd()+'\n')
function visit(name,parent){
 const require=createRequire(path.resolve(parent,'package.json'))
 const json=require.resolve.paths('__package__').map(base=>path.join(base,name,'package.json')).find(file=>fs.existsSync(file))
 if(!json)throw new Error('Package not found: '+name)
 const root=path.dirname(json),p=JSON.parse(fs.readFileSync(json,'utf8'))
 if(visited.has(root))return;visited.add(root)
 const licenseFiles=fs.readdirSync(root).filter(f=>/^(license|copying|notice)(\.|$)/i.test(f)&&fs.statSync(path.join(root,f)).isFile())
 const key=p.name.replaceAll('/','__')+'-'+p.version
 const retained=path.join(out,key+'.txt')
 if(licenseFiles.length)retain(retained,licenseFiles.map(f=>f+'\n\n'+fs.readFileSync(path.join(root,f),'utf8')).join('\n\n'))
 else if(fs.existsSync(path.join(root,'README.md'))&&/## License/i.test(fs.readFileSync(path.join(root,'README.md'),'utf8')))retain(retained,fs.readFileSync(path.join(root,'README.md'),'utf8').split(/## License/i).slice(1).join('## License'))
 else if(!fs.existsSync(retained))throw new Error('Upstream license must be retained: '+key)
 entries.push(`${p.name} ${p.version} — ${p.license}`)
 for(const dependency of Object.keys(p.dependencies||{}))visit(dependency,root)
}
for(const name of Object.keys(JSON.parse(fs.readFileSync('package.json','utf8')).dependencies))visit(name,process.cwd())
fs.writeFileSync(path.join(out,'INDEX.txt'),entries.sort().join('\n')+'\n')
console.log('Retained licenses for '+entries.length+' production packages')
