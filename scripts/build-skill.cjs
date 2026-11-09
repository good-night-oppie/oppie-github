'use strict';
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'skills/oppie-github-work/scripts/review-request.cjs');
const output=require('esbuild').buildSync({absWorkingDir:root,entryPoints:['src/review-cli.cjs'],bundle:true,platform:'node',format:'cjs',target:'node18',outfile:target,write:false}).outputFiles[0].contents;
if(process.argv.includes('--check')){
 if(!Buffer.from(output).equals(fs.readFileSync(target)))throw Error('BUNDLE_OUT_OF_DATE: run npm run build:skill');
 console.log('Skill bundle matches pinned esbuild build');
}else fs.writeFileSync(target,output);
