begin;

-- Repair incomplete Amazon search-result labels with canonical product metadata,
-- remove duplicate or irrelevant search noise, and keep consumer taxonomy out of
-- medicine-only generic-name and dosage-form fields.

create or replace function dawanear_private.dawanear_sync_marketplace_product()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_legacy_category text;
begin
  v_legacy_category := case new.category
    when 'Beauty & Personal Care' then 'Personal care'
    when 'Baby' then 'Baby & family'
    when 'Health & Household' then 'Wellness'
    else new.category
  end;

  if new.publication_status = 'approved' and new.is_active and new.is_orderable then
    insert into public.dawanear_products (
      id, source_register, source_serial, registration_number, brand_name,
      generic_name, strength, dosage_form, pack_size, shelf_life,
      product_type, category, prescription_status, regulatory_status,
      manufacturer, manufacturer_country, marketing_authorization_holder,
      local_technical_representative, registration_date, expiry_date,
      image_url, image_source, is_orderable, is_active, source_name,
      source_url, source_refreshed_at
    ) values (
      new.id, new.source_register, new.source_serial, new.registration_number,
      new.product_name, new.generic_name, new.strength, new.dosage_form,
      new.pack_size, new.shelf_life, 'consumer_product', v_legacy_category,
      'non_prescription', 'unclassified', new.manufacturer,
      new.manufacturer_country, new.marketing_authorization_holder,
      new.local_technical_representative, new.registration_date, new.expiry_date,
      new.image_url, new.image_source, true, true, new.source_name,
      new.source_url, new.source_refreshed_at
    )
    on conflict (id) do update set
      brand_name = excluded.brand_name,
      generic_name = excluded.generic_name,
      strength = excluded.strength,
      dosage_form = excluded.dosage_form,
      pack_size = excluded.pack_size,
      product_type = excluded.product_type,
      category = excluded.category,
      prescription_status = excluded.prescription_status,
      regulatory_status = excluded.regulatory_status,
      manufacturer = excluded.manufacturer,
      manufacturer_country = excluded.manufacturer_country,
      image_url = excluded.image_url,
      image_source = excluded.image_source,
      is_orderable = true,
      is_active = true,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_refreshed_at = excluded.source_refreshed_at;
  else
    update public.dawanear_products
    set is_orderable = false, is_active = false
    where id = new.id and source_register = new.source_register;
  end if;

  return new;
end;
$$;

revoke all on function dawanear_private.dawanear_sync_marketplace_product()
  from public, anon, authenticated;

with corrections(asin, product_name) as (
  values
    ('B00099XNWO', 'Lady Speed Stick Anti-Perspirant & Deodorant, Invisible Dry, Shower Fresh, 1.4 oz (39.6 g)'),
    ('B000EGKTDI', 'Apex Nasal Aspirator'),
    ('B000JLIRT6', 'Degree Antiperspirant Deodorant Shower Clean Pack of 36 72-Hour Sweat & Odor Protection Antiperspirant for Women with Body Heat Activated Technology 0.5 oz'),
    ('B000P9GMHQ', 'Lady Speed Stick Invisible Dry Antiperspirant & Deodorant, Shower Fresh - Purple 2.3 oz'),
    ('B000VAWY7Q', 'Dial, White Deodorant Soap Bars, 4 Ounce, 3 Count'),
    ('B000YK2O3C', 'Degree Original Antiperspirant Deodorant Shower Clean 48-Hour Sweat & Odor Protection Antiperspirant for Women 2.6 oz'),
    ('B00100AKJ0', 'PERSONAL CARE PRODUCTS Antibacterial Soap, 2 Count'),
    ('B0010AU3SI', 'Degree Shower Clean Dry Protection Antiperspirant Deodorant Stick, 1.6 oz , blue'),
    ('B0013OUOBM', 'NOW Foods Sports Nutrition, Creatine Monohydrate Powder, Mass Building*/Energy Production*, 21.2-Ounce'),
    ('B0013OXD38', 'NOW Foods Sports Nutrition, Creatine Monohydrate Powder, Mass Building*/Energy Production*, 2.2-Pound'),
    ('B0014DW0XW', 'Lafe''s Natural Deodorant | 4oz Aluminum Free Natural Deodorant Spray | Paraben Free & Baking Soda Free with 24-Hour Protection | Unscented'),
    ('B0018OADEA', 'NOW Foods Sports Nutrition, Creatine Monohydrate 750 mg, Mass Building*/Energy Production*, 120 Veg Capsules'),
    ('B0019LTHGM', 'NOW Foods Sports Nutrition, Creatine Monohydrate Powder, Mass Building*/Energy Production*, 8-Ounce'),
    ('B001AO0WCG', 'Moroccanoil Treatment, 3.4 Fl. Oz.'),
    ('B001BR4LCO', 'Calvin Klein Eternity Men''s Deodorant With Notes of Mandarin, Sage, Cedarwood & Amber 2.6 fl oz'),
    ('B001ET76WG', 'Degree Original Antiperspirant Deodorant Shower Clean Pack of 6 48-Hour Sweat & Odor Protection Antiperspirant for Women 2.6 oz'),
    ('B001G60EMQ', 'L''Occitane Eau des Baux Stick Deodorant 2.60 oz'),
    ('B001GBIOH8', 'Secret Solid Antiperspirant and Deodorant Shower, Fresh Scent, 1.7 Ounce'),
    ('B002CMLS50', 'Moroccanoil Hydrating Styling Cream, 10.2 Fl. Oz.'),
    ('B002DYIZGC', 'Optimum Nutrition Creatine, Micronized Creatine Monohydrate Capsules, Supports Strength & Recovery, Banned Substance Tested, 2.5g per Serving, 100 Servings, 200 Count'),
    ('B002JIO4OO', 'Xtend Original BCAA Powder, 7g BCAAs and 2.5g L-Glutamine for Muscle Recovery Hydration and Lean Muscle, Sugar Free Intra and Post Workout Drink with Electrolytes, Glacial Grape, 90 Servings'),
    ('B003RW2K0G', 'Moroccanoil Curl Defining Cream, 8.5 Fl. Oz.'),
    ('B004FH2G6A', 'Mitchum Deodorant Womens Gel Shower Fresh 2.25oz (3 Pack)'),
    ('B004X8IB1U', 'Mitchum for Women Clear Gel Antiperspirant & Deodorant-Shower Fresh-2.25 oz, 2 pk'),
    ('B004ZVPNL6', 'Dial Antibacterial Soap Bar, Gold, 6 Count (Pack of 2)'),
    ('B005IHTFM4', 'Shower to Shower Morning Fresh Body Powder with Chamomile for Men & Women, Talc Free, Sweat Absorbing, Prevents Chafing & Odor, Deodorizing All Over Body Powder for Long Lasting Freshness, 13 OZ'),
    ('B005IHUTPG', 'Shower to Shower Morning Fresh Body Powder with Lavender for Men & Women, Talc Free, Sweat Absorbing, Prevents Chafing & Odor, Deodorizing All Over Body Powder for Long Lasting Freshness, 13 OZ'),
    ('B005O1SOZS', 'Lady Speed Stick Deodorant 2.3 Ounce Shower Fresh (68ml)'),
    ('B007762NQE', 'EO, Organic Lavender Deodorant Spray, 4 Fl Oz'),
    ('B007763OS0', 'Eo, Deodorant Spray Citrus Organic, 4 Fl Oz'),
    ('B007CJ657O', 'Arrid XX Extra Extra Dry Solid Antiperspirant Deodorant, Cool Shower, 2.6 oz. (pack of 3)'),
    ('B0087W59FO', 'Speed Stick Unscented Antiperspirant Deodorant 3 oz (Pack of 12)'),
    ('B0098QPV3I', 'Moroccanoil Hydrating Shampoo, 8.5 Fl. Oz.'),
    ('B0098QQ88U', 'Moroccanoil Hydrating Conditioner, 8.5 Fl Oz'),
    ('B009PAF1WS', 'Moroccanoil Curl Defining Cream, 2.53 Fl. Oz.'),
    ('B00A12322U', 'Degree Deodorant Womens Motion Sense Shower Clean Invisible Solid 2.6oz'),
    ('B00BPS3L8E', 'Life Extension Creatine Capsules – Creatine Monohydrate – Promotes Strength, Lean Muscle, Healthy Endurance – Non-GMO, Gluten-Free – 120 Capsules'),
    ('B00CHJUJTO', 'Degree Clinical Strength Antiperspirant Deodorant Shower Clean Soft Solid 96-Hour Sweat and Odor Protection 5x Types of Sweat 1.6 oz'),
    ('B00DNP8MMM', 'Irish Spring Aloe Mist Deodorant Bath Bar, 3.7 oz, 3 ct x 3 Packs (Total of 9 Bars of Soap/Packaging May Vary)'),
    ('B00E4MMW6K', 'Lady Speed Stick Deodorant 1.4 Ounce Shower Fresh (41ml) (3 Pack)'),
    ('B00E4MNPBQ', 'Degree Shower Clean Dry Protection Antiperspirant Deodorant Stick, 1.6 oz (Pack of 2)'),
    ('B00E4MPDUM', 'Secret Anti-Perspirant Deodorant Solid Shower Fresh 1.70 oz (Pack of 2)'),
    ('B00F4L86V0', 'Brut Sport Style Men''s 6.7-ounce Deodorant Spray'),
    ('B00FFJ0AEM', 'Old Spice Body Wash, Swagger, 32 Oz'),
    ('B00HH2TWA8', 'Shower to Shower Sport Body Powder for Men & Women, Talc Free, Sweat Absorbing, Prevents Chafing & Odor, Deodorizing All Over Body Powder for Long Lasting Freshness, 13 OZ'),
    ('B00J5JRJHE', 'Lady Speed Stick Invisible Dry Antiperspirant & Deodorant, Shower Fresh, 1.4 Ounce (Pack of 4)'),
    ('B00JZZY8FO', 'Lady Speed Stick Invisible Dry, Shower Fresh, 2.3 Ounces each (Pack of 4)'),
    ('B00L72HWTM', 'Dial Mountain Fresh Antibacterial Deodorant Soap 4.5 ounces each 3-Count (2 Pack)'),
    ('B00L9NY2X8', 'Xtend Original BCAA Powder, 7g BCAAs and 2.5g L-Glutamine for Muscle Recovery Hydration and Lean Muscle, Sugar Free Intra and Post Workout Drink with Electrolytes, Lemon Lime Squeeze, 30 Servings'),
    ('B00N1PKR36', 'Xtend Original BCAA Powder, 7g BCAAs and 2.5g L-Glutamine for Muscle Recovery Hydration and Lean Muscle, Sugar Free Intra and Post Workout Drink with Electrolytes, Knockout Fruit Punch, 30 Servings'),
    ('B00SM3TOEU', 'Ban Invisible Solid Antiperspirant Deodorant, Shower Fresh, 2.6 Oz, 4 Pack | For Women And Men, 24-Hour Protection, Fights Odor & Sweat, Residue-Free Formula, Smooth Glide-On'),
    ('B00TJ6WLN0', 'Mitchum Women’s Antiperspirant Deodorant Gel Stick, Shower Fresh Scent, 48HR Sweat & Odor Protection, Triple Odor Defense, Alcohol-Free, 3.4 oz (Pack of 2)'),
    ('B00UZX8V0S', 'Mirai Clinical Persimmon Body Wash for Old People Smell, Nonenal® Solution | Moisturising Body Wash for Strong Body Odor, Japanese Persimmon and Green Tea Extracts, For Men and Women, 9.29 Fl oz'),
    ('B00VU06RVK', 'Nubian Heritage 24 Hour Natural Deodorant Honey & Black Seed, 2.25 Oz'),
    ('B00YEJZMHO', 'Fogg Napoleon Body Spray For Men , 150Ml'),
    ('B014N4D6HM', 'BPI Sports Best Creatine - Creatine Monohydrate Powder for Men & Women, Himalayan Salt - Strength, Pump, Muscle Growth, Muscle Definition - No Bloat - Watermelon Cooler - 50 servings - 10.58 Ounce'),
    ('B017UYDYUG', 'Moroccanoil Smoothing Lotion, 2.53 Fl. Oz.'),
    ('B01ABM7K90', 'Dial Antibacterial Bar Soap, Mountain Fresh, 3.2 Ounce, 6 Bars'),
    ('B01BVRO7T0', 'Cellucor Cor-Performance Creatine Monohydrate for Strength and Muscle Growth, 72 Servings'),
    ('B01CKFOQC0', 'Lady Speed Stick Deodorant 1.4 Ounce Shower Fresh (41ml) (2 Pack)'),
    ('B01CKGNUQC', 'Lady Speed Stick Deodorant 2.3oz Shower Fresh (2 Pack)'),
    ('B01GL5V4OI', 'Dial Antibacterial Bar Soap, Mountain Fresh, 4 Ounce, 3 Bars'),
    ('B01HTJTPPK', 'Degree Advanced Antiperspirant Deodorant 4 count 72-Hour Sweat & Odor Protection Shower Clean Antiperspirant for Women with MotionSense Technology 2.6 oz'),
    ('B01IA9CBD6', 'Mitchum Advanced Women Gel Anti-Perspirant & Deodorant, Shower Fresh 2.25 Ounces each (Value Pack of 2)'),
    ('B01IA9DAHC', 'Irish Spring Icy Blast Deodorant Bar Soap 3.75 oz, 8 ea (Pack of 4)'),
    ('B01IADXPE6', 'Ivory Bar Soap, Bath Size, Aloe 10 ea (Pack of 3)'),
    ('B01IAEX61M', 'Dial Antibacterial Deodorant Bar Soap, 4 oz bars, White, Pack of 12'),
    ('B01IAF0Z6K', 'Degree Shower Clean Dry Protection Antiperspirant Deodorant Stick, 0.5 oz (Pack of 8)'),
    ('B01IVWB6FQ', 'Optimum Nutrition CREATINE 2500 300 CAPS'),
    ('B01M28VEPR', 'Xtend Original BCAA Powder, 7g BCAAs and 2.5g L-Glutamine for Muscle Recovery Hydration and Lean Muscle, Sugar Free Intra and Post Workout Drink with Electrolytes, Italian Blood Orange, 30 Servings'),
    ('B01N0A7CVP', 'BulkSupplements.com Creatine Monohydrate Powder - Micronized Creatine Powder, Unflavored - Pure & Gluten Free, 5g (5000mg) per Servings, 100g (3.5 oz) (Pack of 1)'),
    ('B01N5MRF0W', 'Elizabeth Arden White Tea, Women''s Cream Deodorant, 1.5 Oz, Pack of 1'),
    ('B06XTPX8B2', 'Kiko Milano 3D Hydra Lip Gloss – High Shine, Hydrating, Plumping, Non-Sticky, Moisturizing Lip Makeup – 21 Brun Rose – 6.5ml'),
    ('B071J9BDXR', 'Burt''s Bees Baby Unisex Beekeeper Blanket, 100% Organic Cotton, Swaddle Transition Sleeping Bag Wearable, Rugby Stripe Heather Grey, Medium US'),
    ('B071J9BFRN', 'Burts Bees Baby Infant Wearable Blanket Rugby Stripe Blossom Organic Unisex Newborn Clothes Beekeeper - Light Weight 0.5 TOG - (Size Large)'),
    ('B071W7HJ12', 'Burt''s Bees Baby Beekeeper Wearable Blanket Winter, Organic Cotton Swaddle 0.5 or 1.5 TOG, Baby Infant Wearable Blanket & Essentials Shower Gift'),
    ('B0742HNCDC', 'Bath & Body Works Bourbon - Ultra Shea Body Cream 8 oz, 2-in-1 Hair + Body Wash 10 oz & Deodorizing Body Spray 3.7 oz - Set'),
    ('B076PQTSHV', 'Lady Speed Stick Invisible Dry - Shower Fresh 1.4 oz pack of 12'),
    ('B077DN2444', 'KIKO Milano 3d Hydra Lipgloss 17 | Softening Lip Gloss For A 3d Look'),
    ('B077H2P4WS', 'Dial Antibacterial Deodorant Bar Soap, Lavender & Twilight Jasmine, 6 Bars - 3.2 Oz Each'),
    ('B077T2VVF2', 'Old Spice Cleansing Body Wash for Men, 3X Defense, 24/7 Shower Fresh with Lasting Scent, 2-in-1 Body & Face Wash, Bearglove with Crisp Orchard Scent, 33.4 (Pack of 4)'),
    ('B078YGKR6S', 'Nioxin Scalp + Hair Thickening System 2 | For Natural or Untreated Hair with Progressed Thinning| Full Size| 3 Month Supply'),
    ('B0794F14V6', 'Nioxin Scalp + Hair Thickening System 4 |For Colored or Damaged Hair with Progressed Thinning| With Niacinamide and Biotin | Full Size| 3 Month Supply'),
    ('B07DP4XNNH', 'milk + honey Baking Soda Free Deodorant No. 09, Natural Aluminum Free Deodorant for Women and Men, with Lavender and Tea Tree Scent, 2.6 Oz'),
    ('B07F43GT72', 'Xtend Original BCAA Powder, 7g BCAAs and 2.5g L-Glutamine for Muscle Recovery Hydration and Lean Muscle, Sugar Free Intra and Post Workout Drink with Electrolytes, Freedom Ice, 30 Servings'),
    ('B07H3GBSC3', 'amika soulfood nourishing mask, 250ml'),
    ('B07M9RMVQC', 'Old Spice Body Wash for Men, 24/7 Shower Fresh with Lasting Scent, Cleanse & Refresh, Gentle on Skin, Vitamin B3, Fiji with Palm Tree + Coconut Scent, 25 oz (Pack of 4)'),
    ('B07RC9D6WK', 'Bath & Body Works Graphite Men''s Deodorizing Body Spray, 3.7 Fl Oz'),
    ('B07SZN165M', 'BodyTech Shaker Bottle with Wire Whisk BlenderBall - Leak-Proof Mixing for Protein Shakes - Blue (32 fl oz)'),
    ('B07V3TR2ST', 'Native Deodorant Contains Naturally Derived Ingredients, 72 Hour Odor Control, Deodorant for Women and Men, Aluminum Free, Charcoal 2.65oz'),
    ('B07V7Z1GFK', 'Arm & Hammer Invisible Body Powder Spray, Clear Talc-Free Body Odor & Sweat Control For Men & Women, Spray Body Powder For Women And Men, Arm And Hammer Body Spray Powder, 7 Oz (3 Pack)'),
    ('B07YXFK2ZD', 'Curie Natural Deodorant for Women - Orange Neroli 2oz Stick - Aluminum Free Deodorant, Paraben Free, Cruelty Free, Non-Toxic'),
    ('B08FY44JMB', 'Motif Medical Maternity Compression Socks for Comfort & Support - Pregnancy & Postpartum Pressure Socks - Knee-High Pregnancy Compression Socks for Women (Black/Green, Medium)'),
    ('B08FY552KJ', 'Motif Medical Maternity Compression Socks for Comfort & Support - Pregnancy & Postpartum Pressure Socks - Knee-High Pregnancy Compression Socks for Women (White/Grey/Green, Large)'),
    ('B08FY5C637', 'Motif Medical Maternity Compression Socks for Comfort & Support - Pregnancy & Postpartum Pressure Socks - Knee-High Pregnancy Compression Socks for Women (Black/Green, X-Large)'),
    ('B08PG32WHF', 'Anthony Shower Sheets, 12 Single Pack Sheets Alcohol Free Deodorant 2.5 Fl Oz'),
    ('B08RTCD9KC', 'Mustela Gentle Cleansing Gel - Baby Wash for Delicate Skin and Hair - Newborn-Safe Cleanser - Crafted with Natural Avocado Perseose - Various Sizes - 16.90 fl. oz.'),
    ('B08RTJ65HK', 'Mustela Gentle Cleansing Gel - Baby Wash for Delicate Skin and Hair - Newborn-Safe Cleanser - Crafted with Natural Avocado Perseose - Various Sizes - 25.35 fl. oz.'),
    ('B08VY1T1MH', 'AXE Black Mens Body Spray Deodorant 48hr Odor Protection Frozen Pear & Cedarwood Aluminum Free Deodorant Body Spray, 4 Ounce (Pack of 4)'),
    ('B08XQWS6ZP', 'Amazon Essentials Women''s Maternity Nursing Tops, Pregnancy Clothes with Adjustable Straps and Built-in Shelf Bra, Pack of 2, Light Grey Heather, Large'),
    ('B08XQXN9XV', 'Amazon Essentials Women''s Maternity Nursing Tops, Pregnancy Clothes with Adjustable Straps and Built-in Shelf Bra, Pack of 2, White, Large'),
    ('B08XQY6K4M', 'Amazon Essentials Women''s Maternity Nursing Tops, Pregnancy Clothes with Adjustable Straps and Built-in Shelf Bra, Pack of 2, Black/Brown, Large'),
    ('B08XQYBB6F', 'Amazon Essentials Women''s Maternity Nursing Tops, Pregnancy Clothes with Adjustable Straps and Built-in Shelf Bra, Pack of 2, Black/White, Large'),
    ('B08XQZFN3W', 'Amazon Essentials Women''s Maternity Nursing Tops, Pregnancy Clothes with Adjustable Straps and Built-in Shelf Bra, Pack of 2, Black Stripe, Large'),
    ('B09FF37XNZ', 'Pecksniff''s Mens 1L 3-In-1 Cleansing Gel Professional'),
    ('B09HH4FVV2', 'Amplim 2-Pack Hospital & Medical Grade Non Contact Digital Infrared Forehead Thermometer for Babies, Kids, and Adults.'),
    ('B09R5KPNHZ', 'Bucked Up Pure Micronized Creatine Monohydrate for Women and Men - Easy to Mix and Unflavored - 5G Per Serving - 50 Servings - 250 Grams Per Container'),
    ('B09RLLKK4T', 'amika soulfood nourishing mask, 100ml'),
    ('B0B23S4X3K', 'amika Hydro Rush Intense Moisture Leave-In Conditioner with Hyaluronic Acid, 200ml | for all hair types, long-lasting hydration, detangles and reduces frizz'),
    ('B0B441Y59B', 'amika normcore signature shampoo, 275ml'),
    ('B0B75HVR46', 'Optimum Nutrition Amino Energy Powder Plus Focus, with BCAA, Electrolytes, and Caffeine, Juicy Strawberry, 30 Servings (Packaging May Vary)'),
    ('B0B9HWN8S9', 'BulkSupplements.com Creatine Monohydrate Capsules - Micronized Creatine Monohydrate, Sports Nutrition - 7 Capsules per Serving, 5000mg, Gluten Free, 210 Count (Pack of 1)'),
    ('B0BHKZ7LPQ', 'Animal Creatine Monohydrate Powder - Micronized Creatine for Women and Men, Supports Muscle Growth, Strength, Endurance, Recovery and ATP Production, Gym & Workout Supplements - Unflavored, 500g'),
    ('B0BXMPBRJZ', 'Six Star Creatine Monohydrate Powder, X3 (Fruit Punch) - Flavored Creatine HCl Powder Monohydrate Supplement for Muscle Building & Performance - Post Workout Supplement for Men & Women - 30 Servings'),
    ('B0C2Y4FSB5', 'Lume Whole Body Deodorant - Smooth Solid Stick - 72 Hour Odor Control - Aluminum Free, Baking Soda Free and Skin Safe - 2.6 Ounce (Soft Powder)'),
    ('B0CJ53CC8Z', 'OPTOFENDY Progressive Multifocal Reading Glasses for Women Men, Square Blue Light Blocking Computer Readers,Crystal'),
    ('B0CJ542SCL', 'OPTOFENDY Progressive Multifocal Reading Glasses for Women Men, Square Blue Light Blocking Computer Readers, Bright Black'),
    ('B0CJ57K44N', 'OPTOFENDY Progressive Multifocal Reading Glasses for Women Men, Square Blue Light Blocking Computer Readers, Tortoiseshell'),
    ('B0CNJ48DND', 'Old Spice Refreshing Body Wash for Men, 3X Defense, 24/7 Shower Fresh with Long Lasting Scent, Red Collection, Swagger with Cedarwood Scent, 24 oz (Pack of 2)'),
    ('B0CQ9ZG98P', 'Dove Whole Body Deo Aluminum Free pH Balancing Cream Deodorant Coconut & Vanilla for 72h Odor Control 2.5 oz'),
    ('B0CQB2MKTH', 'Dove Whole Body Deodorant Aluminum Free pH Balancing Cream Deodorant Unscented for 72h Odor Control 2.5 oz'),
    ('B0CQLM2LL4', 'OPTOFENDY Progressive Multifocal Reading Glasses for Women Men, Square Blue Light Blocking Computer Readers, 3 Pack Multicolor'),
    ('B0CQPJG4F5', 'MuscleTech | Creatine Chews | Creapure Monohydrate Supplement for Muscle Recovery, Muscle Builder & Energy Boost | Pre Workout Supplement for Men & Women | Citrus Birst | 90 chewable Tablets'),
    ('B0CRZ9Y5Z6', 'Bath & Body Works Antiperspirant Deodorant With 24-hour Sweat and Odor Protection For Men 2.7 Ounce (2.7 Ounce (Pack of 1), Whiskey Reserve)'),
    ('B0CSCYXRCH', 'Dove Advanced Care Antiperspirant Deodorant Spray Clear Finish Invisible antiperspirant deodorant & Body Wash with Pump Deep Moisture For Dry Skin Moisturizing Skin Cleanser'),
    ('B0CSYN2V9Z', 'Irish Spring Icy Blast Bar Soap for Men & Colgate Cavity Protection Toothpaste with Fluoride, Great Regular Flavor, 6 Ounce (Pack of 6)'),
    ('B0CT2KWSBX', 'Ascent 100% Whey Protein Powder, Vanilla Bean 4 lb & Creatine Monohydrate Powder, Unflavored 45 Servings'),
    ('B0CT2MYVP1', 'Ascent 100% Whey Protein Powder, Chocolate Peanut Butter 4 lb & Creatine Monohydrate Powder, Unflavored 45 Servings'),
    ('B0CT3Y5Q7G', 'Ascent 100% Whey Protein Powder, Unflavored 2 lb & Creatine Monohydrate Powder, Unflavored 45 Servings'),
    ('B0CT41KMB7', 'Ascent 100% Whey Protein Powder, Vanilla Bean 2 lb & Creatine Monohydrate Powder, Unflavored 45 Servings'),
    ('B0CT41VXGR', 'Ascent 100% Whey Protein Powder, Chocolate 2 lb & Creatine Monohydrate Powder, Unflavored 45 Servings'),
    ('B0CT44Q1XC', 'Ascent 100% Whey Protein Powder, Chocolate Peanut Butter 2 lb & Creatine Monohydrate Powder, Unflavored 45 Servings'),
    ('B0CTX8NBRS', 'Dove Advanced Care Antiperspirant Cool Essentials 4 Count Deodorant & Body Wash with Pump Deep Moisture For Dry Skin Moisturizing Skin Cleanser'),
    ('B0CTX8QYXG', 'Dove Advanced Care Dry Spray Antiperspirant Deodorant Caring Coconut 3 Count & Dove Body Wash with Pump Deep Moisture For Dry Skin Moisturizing Skin Cleanser'),
    ('B0CTZLF2XQ', 'Dove Antiperspirant Deodorant Stick No White Marks on 100 Colors Clear Finish 48-Hour Sweat & Body Wash with Pump Sensitive Skin Hypoallergenic, Paraben-Free, Sulfate-Free, Cruelty-Free'),
    ('B0CW29V7FS', 'Bath & Body Works Antiperspirant Deodorant With 24-hour Sweat and Odor Protection For Men 2.7 Ounce (Graphite)'),
    ('B0CW6K8KYW', 'Sports Research® Unflavored Organic Collagen Peptides, Unflavored Creatine Monohydrate and Hydrate Electrolytes Powder Packets (16x Variety Pack)'),
    ('B0CXRRRVC4', 'BARE PERFORMANCE NUTRITION BPN Electrolytes Go Packs Variety Pack Bundle'),
    ('B0CYLZBKDD', 'Dove Invisible Solid Antiperspirant Deodorant Stick & Body Wash with Pump Deep Moisture For Dry Skin Moisturizing Skin Cleanser with 24hr Renewing MicroMoisture Nourishes The Driest Skin 30.6 oz'),
    ('B0CYNNWL2P', 'Sports Research® Creatine Monohydrate (100 Servings), Hydrate Electrolytes Variety Packets (16 Count) and Dutch Chocolate Whey Protein Isolate (25 Servings)'),
    ('B0CYP4TF1S', 'Sports Research L-Glutamine (1.1 lbs), Sugar-Free Naturally Flavored Hydrate Electrolytes 16x Variety Packets and Creatine Monohydrate (1.1 lbs)'),
    ('B0CYQBCKWM', 'BARE PERFORMANCE NUTRITION BPN Electrolytes Hydration Drink Mix & Go Gel Endurance Gel Apple Cinnamon Bundle'),
    ('B0D12B2YQS', 'Speed Stick Men''s Deodorant 4 Pack and Irish Spring Body Wash 30 Oz'),
    ('B0D14YHXQ3', 'Gold Bond Men''s Talc-Free Body Powder, 10 oz | Refresh 360 Scent | Wetness Protection | Pack of 2 | Essentials Line'),
    ('B0D2CY5C5J', 'Dove Men + Care Deodorant Stick Extra Fresh 4 Count 72-Hour Odor Protection with Body Wash Eucalyptus + Cedar Oil 26 oz'),
    ('B0D2VS8TPN', 'Dove Beauty Bar Coconut Milk 6 Count & Advanced Care Antiperspirant Deodorant Spray Clear Finish 3.8 oz'),
    ('B0D5KH13GB', 'Optimum Nutrition Amino Energy - Pre Workout with Green Tea, BCAA, Amino Acids, Keto Friendly, Green Coffee Extract, Energy Powder - Tropical Sunrise, 20.6 Ounce, 65 Servings (Packaging May Vary)'),
    ('B0D9C4HC37', 'Secret Whole Body Deodorant Duo, Peach & Vanilla Blossom, 2 pk.'),
    ('B0D9R55QGS', 'CON-CRET Creatine HCl with Electrolytes, Citrus Mango, 40 Count'),
    ('B0DBDWB6DS', 'W Old Discontinued Formula'),
    ('B0DBMLMR9V', 'Dove Men + Care Bundle – Extra Fresh Body Wash & 72H Deodorant + Fresh + Clean 2-in-1 Shampoo and Conditioner, Citrus Scent (3 Piece Set)'),
    ('B0DCB7BL7B', 'Femometer Family Ear Thermometer 2 Pcs'),
    ('B0DFD1CGL7', 'Dove Whole Body Deo Aluminum Free Anti-Chafe Deodorant Stick Raspberry & Rose for 72h Odor Control 2.6 Oz'),
    ('B0DG61VMPM', 'Bath & Body Works Antiperspirant Deodorant With 24-hour Sweat and Odor Protection For Men 2.7 Ounce (2.7 Ounce (Pack of 1), Gingham Hero)'),
    ('B0DP5YPXH3', 'Motherhood Maternity Nursing Nightgown & Robe Set, Chemise Labor and Delivery Gown for Breastfeeding, Core Black, 2-Piece Set, Large'),
    ('B0DP5ZJ5DV', 'Motherhood Maternity Nursing Nightgown & Robe Set, Chemise Labor and Delivery Gown for Breastfeeding, Withered Rose/Rosette Print, 2-Piece Set, Large'),
    ('B0DP5ZKQML', 'Motherhood Maternity Nursing Nightgown & Robe Set, Chemise Labor and Delivery Gown for Breastfeeding, Tea Rose/Garden Evening Print, 2-Piece Set, XX-Large'),
    ('B0DP5ZLZPC', 'Motherhood Maternity Nursing Bras, Women’s Cotton Spandex Wrap Front Sleep Bra, Bralette for Breastfeeding & Pumping, Core Black/Essential Nude (2-Pack, XX-Large) | (Sizes S-3X)'),
    ('B0DP61244B', 'Motherhood Maternity Nursing Bras, Women’s Cotton Spandex Wrap Front Sleep Bra, Bralette for Breastfeeding & Pumping, Mini Dot/Heather Grey (2-Pack, X-Large) | (Sizes S-3X)'),
    ('B0DP61BXXY', 'Motherhood Maternity Nursing Bras, Women’s Cotton Spandex Wrap Front Sleep Bra, Bralette for Breastfeeding & Pumping, Porcelain Pink/Nutmeg, 2-Pack, X-Large'),
    ('B0DSCL3HK8', 'DOVE MEN + CARE Body wash Mixed 4 count For Hydrated, Smooth Skin 18 fl oz'),
    ('B0DSJWSZBZ', 'Summer''s Eve Blissful Escape Whole Body Deodorant for Women, Aluminum-Free Ultimate Odor Control Cream, 3 Oz'),
    ('B0DSR7ZKHL', 'Gnarly Nutrition Creatine Powder, Unflavored (16.05oz) and Gnarly Whey Grass-Fed Protein Supplement, Vanilla (32.0oz)'),
    ('B0DT27RCG3', 'amika Hydro Rush Intense Moisture Leave-In Conditioner with Hyaluronic Acid, 60ml | for all hair types, long-lasting hydration, detangles and reduces frizz, travel size'),
    ('B0DTWPWXFW', 'Optimum Nutrition Performance Nutrition Bundle: Amino Energy Plus Hydration Watermelon Smash (30 Serv), Creatine Monohydrate Blueberry Lemonade (60 Serv), & Gold Standard Whey Fruity Cereal (29 Serv)'),
    ('B0F22TS6XB', 'EO Deodorant Spray, 4 Ounce (Pack of 3), Rose Lemon, made with Essential Oils for Men and Women'),
    ('B0F3N6HSBW', 'BIRDMAN Falcon Performance Vegan Protein Powder + Micronized Creatine Monohydrate Powder'),
    ('B0F3NQ49KX', 'BIRDMAN Bundle Falcon Performance Vegan Protein Powder + Micronized Creatine Monohydrate Powder'),
    ('B0F63VBFZB', 'W By Jake Paul Bar Soap for Men, Moisturizing Vitamin Infused Mens Soap with Shea Butter, Odor Fighting, Fresh Ice Scent, 5 oz'),
    ('B0F68RPCQ5', 'HydroJug Insulated Protein Shaker Bottle 24 oz, Silent Mixing, Black'),
    ('B0F8535R6J', '18.21 Man Made Man Dopp Kit Sweet Tobacco'),
    ('B0FC8GXR3N', 'Old Spice Aluminum Free Deodorant for Men, Fallidudes Limited Edition, 24/7 Frightful Freshness and Odor Protection, PumpKing Pumpkin Spice Scent, 3.0 oz'),
    ('B0FC8KFW8V', 'Secret Fresh Antiperspirant Deodorant for Women, 72hr Breathable Odor Protection with Pro-Hyaluronic Acid, Holiday Invisible Solid, Champagne Blush with Berries, Sugared Rim & Rose Petals Scent, 2.6oz'),
    ('B0FC96CDTD', 'Old Spice Aluminum Free Deodorant for Men, Holidudes Limited Edition, 24/7 Holiday Freshness, Odor Protection, Stocking Stuffer, Lumbersnack with Fresh Pine Scent, 3.0 oz'),
    ('B0FFTZK2W1', 'VMI Sports Creatine Monohydrate Powder Muscle Mass – Strength – Size – Power | 5 Grams per Serving (60 Servings, PEZ Sour Green Apple)'),
    ('B0FHMC5J64', 'Bath & Body Works Antiperspirant Deodorant With 24-hour Sweat and Odor Protection For Men 2.7 Ounce (2.7 Ounce (Pack of 1), Bourbon)'),
    ('B0FHMR2R7S', 'Bath & Body Works Antiperspirant Deodorant With 24-hour Sweat and Odor Protection For Men 2.7 Ounce (2.7 Ounce (Pack of 1), Ocean)'),
    ('B0FJYLS44K', 'Dial Deodorant Bar Soap Spring Water, 12 Count, for Daily Use, Deep Cleansing Body Soap, Gentle on Skin, Bulk Pack for Men, Women, Teens, 4 oz. Each'),
    ('B0FL2NSKQC', 'Sports Research® Creamy Vanilla Whey Protein (63 Servings), Variety Hydrate Electrolytes with Vitamins & Minerals (16 Packets) and Creatine Monohydrate (100 Servings)'),
    ('B0FL2NSX82', 'Sports Research® Whey Protein Isolate Vanilla Flavored (2.1 lb), Variety Pack Hydrate Electrolytes Powder Packets (16 Count) and Creatine Monohydrate (1.1 lb)'),
    ('B0FQXHCDC9', 'Bath & Body Works After Dark Antiperspirant Deodorant, 2.7 oz / 77 g – 48-Hour Sweat Protection, Fresh Masculine Scent, Non-Irritating Formula'),
    ('B0FRB34Y23', 'Old Spice Aluminum Free Deodorant for Men, Summerdudes, 24/7 Odor Protection w/Daily Use, 24/7 Sunny Freshness & Long Lasting Scent, Smooth Glide, Serial Griller with Charred Marshmallow Scent, 3.0 oz'),
    ('B0FTR3DMFC', 'Dounia Perfume 15Ml'),
    ('B0FWMXN7LY', 'Dove Whole Body Deodorant Stick for Women, Anti-Chafe, Coconut Vanilla, 2.4 oz'),
    ('B0FX61XTN9', 'TRU Supplements Hydration Complete BCAA Tropical Popsicle + Plant Based Protein Powder Vanilla Bundle – Electrolytes, L-Carnitine & Vegan Protein for Muscle Recovery, Energy & Performance'),
    ('B0G1VHFSKQ', 'AXE Black Regimen x Fifa World Cup Body Care Gift Set with Body Wash, Deodorant Spray, Antiperspirant Stick & Shower Tool + Socks, 4 Count'),
    ('B0G59TR8NZ', 'W by Jake Paul Body Spray and Body Wash for Men Bundle, Odor Blocking Deodorant Spray and Hydrating Shower Gel, Original Scent'),
    ('B0G59VMWT9', 'W by Jake Paul Body Spray and Body Wash for Men Bundle, Odor Blocking Deodorant Spray and Hydrating Shower Gel, Deep Woods Scent'),
    ('B0G6GRLBCN', 'DOVE MEN + CARE - Limited Edition FIFA World Cup Regimen Body Wash & Deodorant Pack Striker Swag 2 Count for Men for Hydrated Soft Skin & Odor Control'),
    ('B0G95X8W28', 'Convenience Kits International Women''s Premium 14-Piece Travel Kit with Dove Products, Burgundy Cosmetic Bag, Face Hair Body Oral Care Essentials, TSA Compliant'),
    ('B0GGVNVV4K', 'Nutricost Creatine Monohydrate Powder (Watermelon, 500 Gram) - Micronized Creatine Supplement - Vegan, Non-GMO, Gluten Free (Pack of 2)'),
    ('B0GH3XSH3J', 'True Nutrition - Highly Branched Cyclic Dextrin - Carbohydrate Powder for Sustained Intra-Workout Energy, Enhanced Post-Workout Muscle Recovery - Vegan and Non-GMO - Unflavored 1lb (Pack of 2)'),
    ('B0GHD93MTH', 'Isopure 100% Pure Creatine Monohydrate Powder,Sugar Free,Unflavored,5g Creatine Monohydrate Per Serving,1.1 Lbs,100 Servings (Packaging May Vary),(Pack of 2)'),
    ('B0GHF2MN2L', 'Irish Spring Icy Blast Bar Soap for Men, Mens Soap, Smell Fresh and Clean 12 Hours, Men Bars Washing Hands Body, Mild Skin, Recyclable Carton, 3.7 Oz, (Pack of 48)'),
    ('B0GLR2J64J', 'Native Natural Deodorant & Body Wash Bundle for Men Contains Naturally Derived Ingredients, Sea Salt & Cedar Scent, 2.65 oz & 18 oz (Pack of 2)'),
    ('B0GLR3TGGJ', 'Bath & Body Works Body Spray for Men, Ocean Scent, Men’s Spray with Long-Lasting Personal Fragrance, Fresh Coastal Air & Cypress Scent, 3.7 oz - 2 Pack'),
    ('B0GM33SM63', 'Sports Research® Gym Pro Pack - Creatine Monohydrate - Gain Lean Muscle, Improve Performance and Strength and Support Workout Recovery 2.2LB + Hydrate Electrolytes Powder Variety Pack'),
    ('B0GMWVTQV7', 'Old Spice X Super Mario, Desert Detour with Vanilla Sands Scent, Aluminum Free Deodorant + Body & Face Wash Bundle for Men, Smell Super with 24/7 Lasting Freshness & 24/7 Shower Clean (Pack of 2)'),
    ('B0GRM39M3D', 'Optimum Nutrition Amino Energy Powder Plus Focus, with BCAA, Electrolytes, and Caffeine, Juicy Strawberry, 30 Servings (Packaging May Vary) (Pack of 6)'),
    ('B0H18N54N3', 'OFCRVA 12 in 1 Manicure Tools StainlessSteel Nail Clippers Pedicure Scissors Hand Care Foot Kit'),
    ('B0H2BLPM6M', 'Peak Revival-X Turkesterone Tongkat Ali Capsules + Creatine Monohydrate Powder with Electrolyte Hydration Salts, ICY Blue Raspberry, Muscle Strength & Recovery Support, 30 Servings'),
    ('B0H2G19JNW', 'Peak Revival-X Turkesterone Tongkat Ali Capsules + Creatine Monohydrate Powder with Electrolyte Hydration Salts, Grape, Muscle Strength Recovery & Hydration Support'),
    ('B0H2G5K42V', 'Peak Revival-X Turkesterone Tongkat Ali Capsules + Creatine Monohydrate Powder with Electrolyte Hydration Salts, Sour Watermelon, Muscle Strength Recovery & Hydration Support'),
    ('B0H2G6PYTK', 'Peak Revival-X Turkesterone Tongkat Ali Capsules + Creatine Monohydrate Powder with Electrolyte Hydration Salts, Orange Sherbet, Muscle Strength Recovery & Hydration Support, 30 Servings'),
    ('B0H34X5XYQ', 'Laurel Bath House Natural Deodorant | Plant Based Unisex Underarm Stick | Long Lasting High Performing Odor Protection | Sicilian Lemon, Pistachio, Cinnamon Milk | Paraben & Sulfate Free (Cannoli)'),
    ('B0H5PVTPC3', 'TBNLASS 12 in 1 Manicure Tools StainlessSteel Nail Clippers Pedicure Scissors Hand Care Foot Kit'),
    ('B0H62YYRS7', 'Sports Research® Recovery + Hydrate Mix: Creatine Monohydrate Powder (200 Servings) and Sugar-Free & Naturally Flavored Hydrate Electrolytes Powder (90 Servings)')
)
update public.dawanear_marketplace_products as product
set product_name = corrections.product_name,
    updated_at = now()
from corrections
where product.asin = corrections.asin
  and product.product_name is distinct from corrections.product_name;

with overrides(asin, category, subcategory) as (
  values
    ('B0FY8JCF64', 'Beauty & Personal Care', 'Fragrance'),
    ('B00DM14TYC', 'Baby', 'Pregnancy & Maternity')
)
update public.dawanear_marketplace_products as product
set category = overrides.category,
    subcategory = overrides.subcategory,
    updated_at = now()
from overrides
where product.asin = overrides.asin
  and (product.category, product.subcategory) is distinct from
      (overrides.category, overrides.subcategory);

with excluded(asin) as (
  values
    ('1433833840'),
    ('1558329129'),
    ('1579658571'),
    ('1588294862'),
    ('1610025946'),
    ('1636982166'),
    ('1790544343'),
    ('1950968448'),
    ('1975174534'),
    ('1975209028'),
    ('1975245512'),
    ('3032092442'),
    ('0313353468'),
    ('0316515612'),
    ('0323287638'),
    ('0323398944'),
    ('0323555268'),
    ('0323567541'),
    ('032377671X'),
    ('0323810209'),
    ('0323827381'),
    ('0578757672'),
    ('0826168868'),
    ('0986295043'),
    ('B000C1W38O'),
    ('B071ZNKW4P'),
    ('B07KPPG73J'),
    ('B07LFD4MJD'),
    ('B07LFKK7XT'),
    ('B07Z8D9ZKD'),
    ('B084HLZYCM'),
    ('B09HHGG94V'),
    ('B09HHJXFD1'),
    ('B0BYFZ378D'),
    ('B0BZ4D1VSD'),
    ('B0BZ4G1DRC'),
    ('B0BZK711LB'),
    ('B0BZSBWVCT'),
    ('B0C34GHZR7'),
    ('B0C34JH7MR'),
    ('B0C56WYLJ1'),
    ('B0C8PDWTXJ'),
    ('B0C8PHDH5C'),
    ('B0CCC5YFZV'),
    ('B0CCPNXYJB'),
    ('B0CF2RPNBK'),
    ('B0CG68758Q'),
    ('B0CGWP7B9G'),
    ('B0CH2YKNFQ'),
    ('B0CHMK1GDZ'),
    ('B0CJ53VMTQ'),
    ('B0CJPYX679'),
    ('B0CJVDWCDR'),
    ('B0CL49MQTD'),
    ('B0CNH45BN5'),
    ('B0CQZ65XZH'),
    ('B0CS9FDF8H'),
    ('B0D69PNGY5'),
    ('B0D6B3HYZB'),
    ('B0DDKDP65T'),
    ('B0DG3142T6'),
    ('B0DGGWWL4F'),
    ('B0DH6JCN4K'),
    ('B0DJST29VQ'),
    ('B0DPJKT4S4'),
    ('B0DPKMYBMN'),
    ('B0DQPX931R'),
    ('B0DQPY9L5N'),
    ('B0DQPZ1RN7'),
    ('B0DQTJS8DX'),
    ('B0DRJ5L7SQ'),
    ('B0DRJ7HTKL'),
    ('B0DSLFXRVK'),
    ('B0DSPRBZ6W'),
    ('B0DSPRSJWF'),
    ('B0DSVTRN73'),
    ('B0DSVYHFZG'),
    ('B0DSVYMM4J'),
    ('B0DSVZT81K'),
    ('B0F18Z48VB'),
    ('B0F3DJMFDK'),
    ('B0F54LKW6V'),
    ('B0FBSYHYPN'),
    ('B0FBTB5KKB'),
    ('B0FBX3PP52'),
    ('B0FCCHS4FS'),
    ('B0FDQRN2KG'),
    ('B0FDQSF54C'),
    ('B0FFN9N65J'),
    ('B0FFND17LD'),
    ('B0FGQBD2T6'),
    ('B0FGX4H46C'),
    ('B0FGX72187'),
    ('B0FHQNYWL3'),
    ('B0FHQSHS68'),
    ('B0G8XCN5R7'),
    ('B0GZTZSK5S'),
    ('B0H5HPGQ4H'),
    ('B0H5QCTZ3F')
)
update public.dawanear_marketplace_products as product
set publication_status = 'rejected',
    is_orderable = false,
    is_active = false,
    updated_at = now()
from excluded
where product.asin = excluded.asin
  and (
    product.publication_status is distinct from 'rejected'
    or product.is_orderable
    or product.is_active
  );

update public.dawanear_products as product
set brand_name = marketplace.product_name,
    generic_name = marketplace.generic_name,
    dosage_form = marketplace.dosage_form,
    updated_at = now()
from public.dawanear_marketplace_products as marketplace
where product.id = marketplace.id
  and marketplace.publication_status = 'approved'
  and marketplace.is_active
  and marketplace.is_orderable
  and (
    product.brand_name is distinct from marketplace.product_name
    or product.generic_name is distinct from marketplace.generic_name
    or product.dosage_form is distinct from marketplace.dosage_form
  );

create or replace view public.dawanear_all_product_catalog
with (security_invoker = true)
as
select
  catalogue.id, catalogue.registration_number, catalogue.brand_name,
  catalogue.generic_name, catalogue.strength, catalogue.dosage_form,
  catalogue.pack_size, catalogue.product_type, catalogue.category,
  catalogue.category as department, null::text as subcategory,
  catalogue.prescription_status, catalogue.regulatory_status,
  catalogue.manufacturer, catalogue.manufacturer_country,
  catalogue.expiry_date, catalogue.image_url, catalogue.is_orderable,
  catalogue.source_name, catalogue.source_url,
  catalogue.price_min_rwf, catalogue.price_max_rwf,
  catalogue.price_contributors, null::text as amazon_product_url,
  catalogue.indicative_price_rwf, catalogue.price_is_indicative,
  catalogue.indicative_price_basis, catalogue.indicative_price_source_url,
  catalogue.indicative_price_updated_at
from public.dawanear_product_catalog as catalogue
where not exists (
  select 1 from public.dawanear_marketplace_products as marketplace
  where marketplace.id = catalogue.id
)
union all
select
  marketplace.id, marketplace.registration_number, marketplace.product_name as brand_name,
  marketplace.generic_name, marketplace.strength, marketplace.dosage_form,
  marketplace.pack_size, marketplace.product_type, marketplace.category,
  marketplace.category as department, marketplace.subcategory,
  'non_prescription'::text as prescription_status,
  'unclassified'::text as regulatory_status, marketplace.manufacturer,
  marketplace.manufacturer_country, marketplace.expiry_date,
  marketplace.image_url, marketplace.is_orderable, marketplace.source_name,
  marketplace.source_url, product.indicative_price_rwf as price_min_rwf,
  product.indicative_price_rwf as price_max_rwf,
  0::bigint as price_contributors, marketplace.amazon_product_url,
  product.indicative_price_rwf,
  (product.indicative_price_rwf is not null) as price_is_indicative,
  product.indicative_price_basis, product.indicative_price_source_url,
  product.indicative_price_updated_at
from public.dawanear_marketplace_products as marketplace
join public.dawanear_products as product on product.id = marketplace.id
where marketplace.publication_status = 'approved'
  and marketplace.is_active and marketplace.is_orderable;

revoke all on table public.dawanear_all_product_catalog
  from public, anon, authenticated;
grant select on table public.dawanear_all_product_catalog
  to anon, authenticated;

comment on view public.dawanear_all_product_catalog is
  'Unified central catalogue. Consumer rows expose complete canonical product titles and distinct source attributes; taxonomy labels never masquerade as generic names or dosage forms.';

commit;
