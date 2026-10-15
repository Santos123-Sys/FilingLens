/** Run before loading contact information or making any SEC request. No dependencies. */
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function assertSecAccessReviewed(config){
 if(config?.schema!== 'filinglens.sec_acquisition_access.v1' ||
    !['paused','reviewed'].includes(config.state))throw Error('Invalid SEC access policy');
 if(config.state!=='reviewed')throw Error('SEC acquisition paused after official access denial; review SEC access before resuming');
 if(typeof config.reviewReference!=='string'||!/^https:\/\/github\.com\/Santos123-Sys\/FilingLens\/(issues|pull)\/\d+$/.test(config.reviewReference))
  throw Error('A repository issue or PR documenting access clearance is required');
}

async function main(){
 const config=JSON.parse(await readFile('config/sec-acquisition-access.json','utf8'));
 try{assertSecAccessReviewed(config);}
 catch(error){
  const directory='/tmp/sec-official/sec-edgar-filings';
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(`${directory}/acquisition-status.json`,JSON.stringify({
   schema:'filinglens.sec_acquisition_status.v1',status:'paused',
   recordedAt:new Date().toISOString(),reason:'access_review_required',
   imported:[],requestsAttempted:0,requiresAccessReview:true,
  },null,2),{mode:0o600});
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
   'SEC acquisition is paused after an official access denial. No SEC requests were made. Follow docs/sec-access-recovery.md; a successful build is not acquisition success.\n');
  throw error;
 }
 console.log('SEC access review recorded; single-request/no-retry acquisition policy applies.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
 console.error('SEC_ACCESS_REVIEW_REQUIRED: see config/sec-acquisition-access.json and docs/sec-access-recovery.md');
 process.exitCode=1;
});
