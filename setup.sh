unzip storyvista_complete.zip
cd storyvista_complete
npm install
cp .env.example .env
# fill in your keys, then:
npm run migrate && npm run migrate:media && npm run migrate:voice
npm run worker &
npm start


#manual ingest

# 1. National Geographic Kids
npm run ingest -- --sources=natgeo-kids

# 2. BBC Bitesize
npm run ingest -- --sources=bbc-bitesize

# 3. NASA Space Place
npm run ingest -- --sources=nasa-kids

# 4. Britannica Kids
npm run ingest -- --sources=britannica-kids

# 5. Wikipedia Simple English
npm run ingest -- --sources=wikipedia-simple

# 6. Khan Academy
npm run ingest -- --sources=khan-academy

# 7. DK Find Out
npm run ingest -- --sources=dkfindout

# 8. NERDC Nigeria
npm run ingest -- --sources=nerdc
