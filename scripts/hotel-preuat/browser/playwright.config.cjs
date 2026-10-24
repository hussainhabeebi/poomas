const {defineConfig}=require('@playwright/test');
if(!process.env.HOTEL_REPO_ROOT)throw Error('Repository path required');
module.exports=defineConfig({testDir:__dirname,testMatch:'hotel.spec.cjs',workers:1,retries:0,timeout:60000,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:3000',serviceWorkers:'block',screenshot:'on',trace:'retain-on-failure'},
 projects:[375,390,768,1440].map(width=>({name:`width-${width}`,use:{viewport:{width,height:900}}})),
 webServer:{command:'node scripts/hotel-preuat/preview.mjs',cwd:process.env.HOTEL_REPO_ROOT,url:'http://127.0.0.1:3000/hotels',reuseExistingServer:false,timeout:120000}
});
