const {test,expect}=require('@playwright/test');
test.beforeEach(async({context})=>{
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  return ['127.0.0.1','localhost'].includes(u.hostname)?route.continue():route.abort();
 });
 await context.request.get('http://127.0.0.1:4001/fixture/login',{maxRedirects:0});
 await context.request.get('http://127.0.0.1:4001/fixture/scenario?value=success');
});
const occupancy=[{adults:1,children:1,childAge:[6]},{adults:2,children:0,childAge:[]}];
function query(rooms=occupancy){return new URLSearchParams({hid:'fixture-hotel',sid:'a'.repeat(32),checkIn:'2027-02-10',checkOut:'2027-02-12',rooms:String(rooms.length),occupancy:JSON.stringify(rooms)});}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);}
test('search/results, explicit multi-room review, guests, acceptance, refresh and My Trips',async({page})=>{
 await page.goto('/hotels');await expect(page.getByRole('heading',{level:1})).toBeVisible();await noOverflow(page);
 await page.goto('/hotels/search?city=DXB&cityName=Dubai&checkIn=2027-02-10&checkOut=2027-02-12&rooms=2&occupancy='+encodeURIComponent(JSON.stringify(occupancy)));
 await expect(page.getByText('Local Fixture Hotel — NOT BOOKABLE')).toBeVisible();
 await page.getByRole('link',{name:/Choose rooms/}).click();
 await page.getByRole('button',{name:'Select and review'}).click();
 await expect(page.locator('input[autocomplete="given-name"]')).toHaveCount(4);
 await page.reload();await expect(page.locator('input[autocomplete="given-name"]')).toHaveCount(4);
 for(let i=0;i<4;i++){await page.locator('input[autocomplete="given-name"]').nth(i).fill('Fixture'+String.fromCharCode(65+i));await page.locator('input[autocomplete="family-name"]').nth(i).fill('Guest');}
 await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByLabel('Phone',{exact:true}).fill('5551234567');
 const submit=page.getByRole('button',{name:'Submit authorized UAT booking'});await expect(submit).toBeDisabled();
 await page.getByRole('checkbox').check();await noOverflow(page);await submit.click();
 await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'My Trips',exact:true}).last().click();await expect(page.getByRole('region',{name:'Hotel bookings'})).toBeVisible();await noOverflow(page);
});
test('single room, changed quotation, disabled booking and sold-out errors',async({page,context})=>{
 await context.request.get('http://127.0.0.1:4001/fixture/scenario?value=changed');
 await page.goto('/hotels/book?'+query([{adults:1,children:0,childAge:[]}]));await page.getByRole('button',{name:'Select and review'}).click();
 await expect(page.getByText(/supplier price changed/)).toBeVisible();await expect(page.locator('input[autocomplete="given-name"]')).toHaveCount(1);
 await context.request.get('http://127.0.0.1:4001/fixture/scenario?value=disabled');await page.getByRole('button',{name:'Refresh quotation'}).click();await expect(page.getByRole('button',{name:'Submit authorized UAT booking'})).toBeDisabled();
 await context.request.get('http://127.0.0.1:4001/fixture/scenario?value=soldout');await page.goto('/hotels/book?'+query());await expect(page.getByRole('alert')).toContainText('sold out');await noOverflow(page);
});

test('unknown and held fixture attempts survive UI refresh without resubmission',async({page,context})=>{
 for(const scenario of ['unknown','hold']){
  await context.request.get('http://127.0.0.1:4001/fixture/scenario?value='+scenario);
  const quote=await (await context.request.post('http://127.0.0.1:4001/api/profile/hotels/review',{headers:{authorization:'Bearer local-hotel-fixture'},data:{rooms:occupancy}})).json();
  const a=await (await context.request.post('http://127.0.0.1:4001/api/profile/hotels/book',{headers:{authorization:'Bearer local-hotel-fixture'},data:{quoteId:quote.quoteId,idempotencyKey:scenario+'-'+Date.now()}})).json();
  await page.goto('/hotels/book?attempt='+encodeURIComponent(a.id));
  await expect(page.getByRole('heading',{name:scenario==='hold'?'On hold — not confirmed':'Booking status: UNKNOWN',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Submit authorized UAT booking'})).toHaveCount(0);await noOverflow(page);
 }
});
