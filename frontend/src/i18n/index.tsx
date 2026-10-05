/**
 * Three-language strings for the public portal and the driver app (English, मराठी, हिंदी).
 * The choice is remembered on the device. Staff screens stay in English.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'en' | 'mr' | 'hi';
export const LANGS: { id: Lang; label: string; short: string; speech: string }[] = [
  { id: 'en', label: 'English', short: 'EN', speech: 'en-IN' },
  { id: 'mr', label: 'मराठी', short: 'मरा', speech: 'mr-IN' },
  { id: 'hi', label: 'हिंदी', short: 'हिं', speech: 'hi-IN' },
];
export const speechLocale = (l: Lang) => LANGS.find(x => x.id === l)!.speech;

type Dict = Record<string, [string, string, string]>; // [en, mr, hi]

const D: Dict = {
  // shell
  'lang.label': ['Language', 'भाषा', 'भाषा'],
  'portal.tagline': ['Water for every community', 'प्रत्येक वस्तीसाठी पाणी', 'हर बस्ती के लिए पानी'],
  'tab.report': ['Report a problem', 'तक्रार नोंदवा', 'शिकायत करें'],
  'tab.water': ['When is water coming?', 'पाणी कधी येणार?', 'पानी कब आएगा?'],
  'tab.track': ['Check status', 'स्थिती पहा', 'स्थिति देखें'],
  'tab.request': ['Request water', 'पाणी मागवा', 'पानी मँगवाएँ'],
  // report
  'report.eyebrow': ['For residents · no account needed', 'नागरिकांसाठी · खाते लागत नाही', 'नागरिकों के लिए · खाता ज़रूरी नहीं'],
  'report.title': ['Report a water problem', 'पाण्याची तक्रार नोंदवा', 'पानी की शिकायत दर्ज करें'],
  'report.step1': ['Your town or village', 'तुमचे गाव किंवा शहर', 'आपका गाँव या शहर'],
  'report.step2': ['What is the problem?', 'काय समस्या आहे?', 'क्या समस्या है?'],
  'report.step2hint': ['Type, or tap the microphone and speak.', 'लिहा, किंवा माइकवर टॅप करून बोला.', 'लिखें, या माइक दबाकर बोलें.'],
  'report.step3': ['Contact (optional)', 'संपर्क (ऐच्छिक)', 'संपर्क (वैकल्पिक)'],
  'report.placeholder': ['e.g. No water for 3 days in lane 4', 'उदा. गल्ली ४ मध्ये ३ दिवस पाणी नाही', 'जैसे: गली 4 में 3 दिन से पानी नहीं'],
  'report.name': ['Name', 'नाव', 'नाम'],
  'report.phone': ['Phone', 'फोन', 'फ़ोन'],
  'report.submit': ['Submit complaint', 'तक्रार पाठवा', 'शिकायत भेजें'],
  'report.saveOffline': ['Save, send when online', 'जतन करा, नेटवर्क आल्यावर पाठवू', 'सहेजें, नेटवर्क आने पर भेजेंगे'],
  'report.privacy': ['Goes straight to the water operations room. Your phone number is used only about this complaint. Your location never leaves this device.',
    'थेट पाणी नियंत्रण कक्षाकडे जाते. फोन नंबर फक्त या तक्रारीसाठी वापरला जातो. तुमचे स्थान या फोनबाहेर जात नाही.',
    'सीधे जल नियंत्रण कक्ष तक जाती है. फ़ोन नंबर सिर्फ़ इसी शिकायत के लिए है. आपकी लोकेशन इस फ़ोन से बाहर नहीं जाती.'],
  'report.chooseFirst': ['Choose your town or village first.', 'आधी तुमचे गाव निवडा.', 'पहले अपना गाँव चुनें.'],
  'report.done': ['Complaint registered', 'तक्रार नोंदवली', 'शिकायत दर्ज हुई'],
  'report.keep': ['Keep this number to follow up with your ward water office.', 'पाठपुराव्यासाठी हा क्रमांक जपून ठेवा.', 'आगे की जानकारी के लिए यह नंबर संभालकर रखें.'],
  'report.another': ['Report another problem', 'आणखी तक्रार नोंदवा', 'एक और शिकायत करें'],
  'report.queued': ['Saved on this phone', 'या फोनवर जतन केले', 'इस फ़ोन पर सहेजा गया'],
  'report.queuedBody': ['There is no network right now. Your complaint is safe on this phone and will be sent automatically when the connection returns.',
    'आत्ता नेटवर्क नाही. तुमची तक्रार या फोनवर सुरक्षित आहे आणि नेटवर्क आल्यावर आपोआप पाठवली जाईल.',
    'अभी नेटवर्क नहीं है. आपकी शिकायत इस फ़ोन पर सुरक्षित है और नेटवर्क आते ही अपने आप भेज दी जाएगी.'],
  // water request
  'req.title': ['Ask for a water tanker', 'पाण्याचा टँकर मागवा', 'पानी का टैंकर मँगवाएँ'],
  'req.sub': ['Requests are served by need, not by who asked first. You will see why yours gets its priority.',
    'विनंत्या आधी कोणी मागितले यावरून नाही, तर गरजेनुसार पूर्ण होतात. तुमच्या विनंतीला प्राधान्य का मिळाले ते तुम्हाला दिसेल.',
    'अनुरोध पहले माँगने वाले के हिसाब से नहीं, ज़रूरत के हिसाब से पूरे होते हैं. आपके अनुरोध को प्राथमिकता क्यों मिली, यह आपको दिखेगा.'],
  'req.people': ['How many people need water?', 'किती लोकांना पाणी हवे?', 'कितने लोगों को पानी चाहिए?'],
  'req.peopleHint': ['Your household, or the group you are asking for.', 'तुमचे कुटुंब, किंवा ज्यांच्यासाठी मागत आहात तो गट.', 'आपका परिवार, या वह समूह जिसके लिए माँग रहे हैं.'],
  'req.days': ['Days without enough water', 'पुरेसे पाणी न मिळालेले दिवस', 'कितने दिन से पर्याप्त पानी नहीं'],
  'req.why': ['What happened?', 'काय झाले?', 'क्या हुआ?'],
  'req.whyHint': ['Pick one, or type or speak in your own words.', 'एक निवडा, किंवा तुमच्या शब्दांत लिहा किंवा बोला.', 'एक चुनें, या अपने शब्दों में लिखें या बोलें.'],
  'req.r.well': ['Our well or borewell has dried up', 'आमची विहीर / बोअरवेल आटली', 'हमारा कुआँ / बोरवेल सूख गया'],
  'req.r.tap': ['Tap supply has stopped', 'नळाचे पाणी बंद आहे', 'नल का पानी बंद है'],
  'req.r.tanker': ['The tanker did not come', 'टँकर आला नाही', 'टैंकर नहीं आया'],
  'req.r.unsafe': ['The water we have is not safe to drink', 'आमच्याकडचे पाणी पिण्यायोग्य नाही', 'हमारे पास का पानी पीने लायक नहीं'],
  'req.contact': ['Contact (so the tanker crew can reach you)', 'संपर्क (टँकरवाल्यांना तुमच्याशी बोलता यावे म्हणून)', 'संपर्क (ताकि टैंकर वाले आपसे बात कर सकें)'],
  'req.submit': ['Send request', 'विनंती पाठवा', 'अनुरोध भेजें'],
  'req.privacy': ['Your name and phone go only to the water operations room, never onto a public page. Your location never leaves this device.',
    'तुमचे नाव व फोन फक्त पाणी नियंत्रण कक्षाकडे जातात, कोणत्याही सार्वजनिक पानावर नाही. तुमचे स्थान या फोनबाहेर जात नाही.',
    'आपका नाम और फ़ोन सिर्फ़ जल नियंत्रण कक्ष तक जाते हैं, किसी सार्वजनिक पेज पर नहीं. आपकी लोकेशन इस फ़ोन से बाहर नहीं जाती.'],
  'req.done': ['Request received', 'विनंती मिळाली', 'अनुरोध मिल गया'],
  'req.keep': ['Keep this number. Check its progress any time under "Check status".', 'हा क्रमांक जपून ठेवा. "स्थिती पहा" मध्ये कधीही प्रगती पाहा.', 'यह नंबर संभालकर रखें. "स्थिति देखें" में कभी भी प्रगति देखें.'],
  'req.merged': ['Someone from {place} has already asked. Your request joined {id}, so your place is counted once and served together.',
    '{place} मधून आधीच विनंती आली आहे. तुमची विनंती {id} मध्ये जोडली, म्हणजे तुमचे गाव एकदाच मोजले जाईल आणि एकत्र पाणी मिळेल.',
    '{place} से पहले ही अनुरोध आया है. आपका अनुरोध {id} में जोड़ा गया, ताकि आपकी जगह एक बार गिनी जाए और साथ में पानी मिले.'],
  'req.queuedBody': ['There is no network right now. Your request is safe on this phone and will be sent automatically when the connection returns.',
    'आत्ता नेटवर्क नाही. तुमची विनंती या फोनवर सुरक्षित आहे आणि नेटवर्क आल्यावर आपोआप पाठवली जाईल.',
    'अभी नेटवर्क नहीं है. आपका अनुरोध इस फ़ोन पर सुरक्षित है और नेटवर्क आते ही अपने आप भेज दिया जाएगा.'],
  'req.another': ['Make another request', 'आणखी विनंती करा', 'एक और अनुरोध करें'],
  'req.litres': ['About {n} litres a day for the people you named', 'तुम्ही सांगितलेल्या लोकांसाठी दिवसाला सुमारे {n} लिटर', 'आपके बताए लोगों के लिए रोज़ लगभग {n} लीटर'],
  // why this priority
  'why.title': ['Why this priority', 'हे प्राधान्य का?', 'यह प्राथमिकता क्यों?'],
  'why.score': ['Priority {n} out of 100', 'प्राधान्य: 100 पैकी {n}', 'प्राथमिकता: 100 में से {n}'],
  'why.points': ['+{n} pts', '+{n} गुण', '+{n} अंक'],
  'why.queue': ['Place in line: {n} of {total} waiting', 'रांगेत क्रमांक: {total} पैकी {n}', 'कतार में स्थान: {total} में से {n}'],
  'why.note': ['Every request is scored the same way, from public records and live data about the place. The highest need is served first, not the first caller.',
    'प्रत्येक विनंतीला गावाच्या सार्वजनिक नोंदी व ताज्या माहितीवरून एकाच पद्धतीने गुण दिले जातात. आधी फोन करणाऱ्याला नाही, तर सर्वाधिक गरज असलेल्यांना आधी पाणी मिळते.',
    'हर अनुरोध को जगह के सार्वजनिक रिकॉर्ड और ताज़ा जानकारी से एक ही तरीके से अंक मिलते हैं. पहले फ़ोन करने वाले को नहीं, सबसे ज़्यादा ज़रूरत वालों को पहले पानी मिलता है.'],
  'factor.demand': ['How much water the place is short', 'गावात किती पाणी कमी पडते', 'जगह में कितना पानी कम पड़ता है'],
  'factor.vulnerability': ['How vulnerable the place is', 'गाव किती असुरक्षित आहे', 'जगह कितनी असुरक्षित है'],
  'factor.unmetNeed': ['Need not yet met, incl. days without water', 'अपूर्ण गरज (पाणी न मिळालेले दिवस धरून)', 'अधूरी ज़रूरत (बिना पानी के दिन सहित)'],
  'factor.previousCoverage': ['Little water delivered in the last 7 days', 'मागील ७ दिवसांत कमी पाणी मिळाले', 'पिछले 7 दिन में कम पानी पहुँचा'],
  'factor.population': ['Number of people living there', 'तेथे राहणाऱ्या लोकांची संख्या', 'वहाँ रहने वाले लोगों की संख्या'],
  'factor.liveCrisis': ['Drought signals (rainfall, news)', 'दुष्काळाचे संकेत (पाऊस, बातम्या)', 'सूखे के संकेत (बारिश, खबरें)'],
  'factor.waterAccess': ['Distance to the nearest water source', 'जवळच्या पाणी स्रोताचे अंतर', 'नज़दीकी जल स्रोत की दूरी'],
  'urgency.Critical': ['Critical', 'अतितातडीचे', 'अति आवश्यक'],
  'urgency.High': ['High', 'उच्च', 'उच्च'],
  'urgency.Medium': ['Medium', 'मध्यम', 'मध्यम'],
  'urgency.Low': ['Low', 'कमी', 'कम'],
  'rstatus.Pending': ['Received', 'मिळाली', 'मिला'],
  'rstatus.Allocated': ['Water allotted', 'पाणी मंजूर', 'पानी मंज़ूर'],
  'rstatus.Dispatched': ['Tanker on the way', 'टँकर निघाला', 'टैंकर रवाना'],
  'rstatus.Delivered': ['Delivered', 'पाणी पोहोचले', 'पानी पहुँचा'],
  'rstatus.Rejected': ['Not approved', 'मंजूर नाही', 'मंज़ूर नहीं'],
  'rstatus.coverage': ['Estimated share of {place}\'s daily need covered today: {n}%', '{place} च्या दैनंदिन गरजेपैकी आज भागणारा अंदाजे हिस्सा: {n}%', '{place} की रोज़ की ज़रूरत में से आज पूरा होने वाला अनुमानित हिस्सा: {n}%'],
  // place picker
  'place.search': ['Type your town or village', 'तुमच्या गावाचे नाव लिहा', 'अपने गाँव का नाम लिखें'],
  'place.useLocation': ['Use my location', 'माझे स्थान वापरा', 'मेरी लोकेशन लें'],
  'place.change': ['Change', 'बदला', 'बदलें'],
  'place.nearby': ['Nearby', 'जवळपास', 'आसपास'],
  'place.district': ['district', 'जिल्हा', 'ज़िला'],
  'place.denied': ['Location permission was denied. Search for your area instead.', 'स्थान परवानगी नाकारली. गावाचे नाव शोधा.', 'लोकेशन की अनुमति नहीं मिली. गाँव का नाम खोजें.'],
  'place.failed': ['Could not get your location. Search for your area instead.', 'स्थान मिळाले नाही. गावाचे नाव शोधा.', 'लोकेशन नहीं मिली. गाँव का नाम खोजें.'],
  'place.offlineList': ['Using the saved list of places (offline).', 'जतन केलेली गावांची यादी वापरत आहोत (ऑफलाइन).', 'सहेजी गई गाँवों की सूची (ऑफ़लाइन).'],
  // voice
  'voice.speak': ['Speak', 'बोला', 'बोलें'],
  'voice.listening': ['Listening… speak now', 'ऐकत आहे… आता बोला', 'सुन रहे हैं… अब बोलें'],
  'voice.processing': ['Writing down what you said…', 'तुम्ही जे बोललात ते लिहित आहे…', 'आपकी बात लिख रहे हैं…'],
  'voice.done': ['Added. Check the text and edit if needed.', 'जोडले. मजकूर तपासा, गरज असल्यास बदला.', 'जोड़ दिया. टेक्स्ट जाँचें, ज़रूरत हो तो बदलें.'],
  'voice.noSpeech': ['Did not hear anything. Tap the microphone and try again.', 'काहीही ऐकू आले नाही. पुन्हा प्रयत्न करा.', 'कुछ सुनाई नहीं दिया. फिर से कोशिश करें.'],
  'voice.denied': ['Microphone permission is blocked. Allow it in the browser settings, or type instead.', 'मायक्रोफोन परवानगी बंद आहे. ब्राउझर सेटिंगमध्ये परवानगी द्या, किंवा लिहा.', 'माइक की अनुमति बंद है. ब्राउज़र सेटिंग में अनुमति दें, या लिखें.'],
  'voice.unsupported': ['Voice input is not available in this browser. Please type.', 'या ब्राउझरमध्ये आवाज सुविधा नाही. कृपया लिहा.', 'इस ब्राउज़र में आवाज़ सुविधा नहीं है. कृपया लिखें.'],
  'voice.offline': ['Voice input needs a network connection. Please type.', 'आवाज सुविधेसाठी नेटवर्क लागते. कृपया लिहा.', 'आवाज़ के लिए नेटवर्क चाहिए. कृपया लिखें.'],
  'voice.error': ['Voice input stopped. Try again or type.', 'आवाज सुविधा थांबली. पुन्हा प्रयत्न करा किंवा लिहा.', 'आवाज़ रुक गई. फिर कोशिश करें या लिखें.'],
  'voice.stop': ['Stop', 'थांबा', 'रुकें'],
  'voice.readAloud': ['Read aloud', 'मोठ्याने वाचा', 'पढ़कर सुनाएँ'],
  // offline outbox
  'net.offline': ['You are offline', 'तुम्ही ऑफलाइन आहात', 'आप ऑफ़लाइन हैं'],
  'net.offlineBody': ['You can still write a complaint. It will be sent when the network returns.', 'तरीही तक्रार लिहू शकता. नेटवर्क आल्यावर ती पाठवली जाईल.', 'फिर भी शिकायत लिख सकते हैं. नेटवर्क आने पर भेज दी जाएगी.'],
  'outbox.title': ['Waiting to send', 'पाठवायचे बाकी', 'भेजने के लिए बाकी'],
  'outbox.sending': ['Sending…', 'पाठवत आहे…', 'भेज रहे हैं…'],
  'outbox.sent': ['Sent', 'पाठवली', 'भेज दी'],
  'outbox.failed': ['Not sent yet', 'अजून पाठवली नाही', 'अभी नहीं भेजी'],
  'outbox.retry': ['Try again now', 'आता पुन्हा पाठवा', 'अभी फिर भेजें'],
  'outbox.remove': ['Remove', 'काढा', 'हटाएँ'],
  'outbox.autoRetry': ['Will retry automatically', 'आपोआप पुन्हा प्रयत्न होईल', 'अपने आप फिर कोशिश होगी'],
  'outbox.savedAt': ['Written', 'लिहिली', 'लिखी'],
  'outbox.allSent': ['Everything saved on this phone was sent.', 'या फोनवर जतन केलेले सर्व पाठवले.', 'इस फ़ोन पर सहेजा गया सब भेज दिया गया.'],
  'install.cta': ['Install app', 'ॲप इन्स्टॉल करा', 'ऐप इंस्टॉल करें'],
  'install.hint': ['Works without network for reporting', 'नेटवर्कशिवायही तक्रार नोंदवता येते', 'बिना नेटवर्क भी शिकायत दर्ज करें'],
  // schedule page
  'water.title': ['When is water coming?', 'पाणी कधी येणार?', 'पानी कब आएगा?'],
  'water.sub': ['Tap timings and supply notices published by your water office.', 'तुमच्या पाणी कार्यालयाने जाहीर केलेल्या नळाच्या वेळा व सूचना.', 'आपके जल कार्यालय द्वारा जारी नल का समय और सूचनाएँ.'],
  'water.next': ['Next water', 'पुढील पाणी', 'अगला पानी'],
  'water.now': ['Water is running now', 'आत्ता पाणी सुरू आहे', 'अभी पानी आ रहा है'],
  'water.until': ['until', 'पर्यंत', 'तक'],
  'water.noSchedule': ['Your water office has not published tap timings for this place yet.', 'या गावासाठी अजून नळाच्या वेळा जाहीर झाल्या नाहीत.', 'इस जगह के लिए अभी नल का समय जारी नहीं हुआ है.'],
  'water.allTimings': ['All timings', 'सर्व वेळा', 'सभी समय'],
  'water.notices': ['Notices', 'सूचना', 'सूचनाएँ'],
  'water.tanker': ['Tanker', 'टँकर', 'टैंकर'],
  'water.tanker.scheduled': ['A tanker is scheduled for your area.', 'तुमच्या भागासाठी टँकर ठरला आहे.', 'आपके इलाके के लिए टैंकर तय है.'],
  'water.tanker.on_the_way': ['A tanker is on the way.', 'टँकर येत आहे.', 'टैंकर रास्ते में है.'],
  'water.tanker.arrived': ['The tanker has arrived.', 'टँकर पोहोचला आहे.', 'टैंकर पहुँच गया है.'],
  'water.noTanker': ['No tanker trip to this place is open right now.', 'आत्ता या गावासाठी टँकर फेरी नाही.', 'अभी इस जगह के लिए कोई टैंकर फेरा नहीं है.'],
  'water.lastDelivery': ['Last tanker delivery', 'शेवटचा टँकर', 'पिछली टैंकर डिलीवरी'],
  'water.coverage': ['Estimated supply vs need', 'अंदाजे पुरवठा विरुद्ध गरज', 'अनुमानित आपूर्ति बनाम ज़रूरत'],
  'water.estimate': ['Estimate', 'अंदाज', 'अनुमान'],
  'water.pick': ['Find your place', 'तुमचे गाव शोधा', 'अपनी जगह खोजें'],
  'water.published': ['Places with published timings', 'वेळा जाहीर असलेली गावे', 'जिन जगहों का समय जारी है'],
  'water.offlineCopy': ['Showing the copy saved on this phone. It may be out of date.', 'या फोनवर जतन केलेली माहिती. ती जुनी असू शकते.', 'इस फ़ोन पर सहेजी जानकारी. यह पुरानी हो सकती है.'],
  'notice.interruption': ['Supply interruption', 'पाणीपुरवठा बंद', 'आपूर्ति बाधित'],
  'notice.extra_supply': ['Extra supply', 'जादा पाणी', 'अतिरिक्त आपूर्ति'],
  'notice.quality': ['Water quality advisory', 'पाणी गुणवत्ता सूचना', 'पानी गुणवत्ता सूचना'],
  'notice.info': ['Information', 'माहिती', 'जानकारी'],
  'kind.tap': ['Tap', 'नळ', 'नल'],
  'kind.standpost': ['Standpost', 'सार्वजनिक नळ', 'सार्वजनिक नल'],
  'kind.piped': ['Piped supply', 'नळ योजना', 'पाइप आपूर्ति'],
  'kind.tanker_halt': ['Tanker halt', 'टँकर थांबा', 'टैंकर पड़ाव'],
  // ticket tracking
  'track.title': ['Check a request or complaint', 'विनंती किंवा तक्रारीची स्थिती पहा', 'अनुरोध या शिकायत की स्थिति देखें'],
  'track.placeholder': ['Number, e.g. WR-1050 or C-2001', 'क्रमांक, उदा. WR-1050 किंवा C-2001', 'नंबर, जैसे WR-1050 या C-2001'],
  'track.go': ['Check', 'पहा', 'देखें'],
  'track.notFound': ['Nothing found with that number.', 'या क्रमांकाची नोंद नाही.', 'इस नंबर का कुछ नहीं मिला.'],
  'track.mine': ['Sent from this phone', 'या फोनवरून पाठवलेले', 'इस फ़ोन से भेजे गए'],
  'status.Pending': ['Received', 'मिळाली', 'मिली'],
  'status.Escalated': ['Escalated to officer', 'अधिकाऱ्याकडे पाठवली', 'अधिकारी को भेजी'],
  'status.Assigned': ['Officer assigned', 'अधिकारी नेमला', 'अधिकारी नियुक्त'],
  'status.Resolved': ['Resolved', 'सोडवली', 'हल हुई'],
  // driver
  'drv.title': ['Driver', 'चालक', 'ड्राइवर'],
  'drv.online': ['Online', 'ऑनलाइन', 'ऑनलाइन'],
  'drv.offline': ['Offline', 'ऑफलाइन', 'ऑफ़लाइन'],
  'drv.vehicle': ['Vehicle', 'वाहन', 'वाहन'],
  'drv.noTrip': ['No active assignment', 'सध्या फेरी नाही', 'अभी कोई फेरा नहीं'],
  'drv.noTripBody': ['Your trip will appear here when the dispatcher assigns it.', 'नियंत्रकाने फेरी दिल्यावर ती इथे दिसेल.', 'डिस्पैचर फेरा देगा तो यहाँ दिखेगा.'],
  'drv.refresh': ['Refresh', 'पुन्हा तपासा', 'रिफ़्रेश'],
  'drv.accept': ['ACCEPT TRIP', 'फेरी स्वीकारा', 'फेरा स्वीकारें'],
  'drv.start': ['START TRIP', 'फेरी सुरू करा', 'फेरा शुरू करें'],
  'drv.arrived': ['ARRIVED', 'पोहोचलो', 'पहुँच गया'],
  'drv.confirm': ['ARRIVED · CONFIRM', 'पोहोचलो · खात्री करा', 'पहुँच गया · पुष्टि करें'],
  'drv.deliveryDone': ['DELIVERY DONE', 'पाणी दिले', 'पानी दे दिया'],
  'drv.end': ['END TRIP', 'फेरी संपवा', 'फेरा खत्म करें'],
  'drv.startHint': ['Needs a fresh GPS fix with accuracy ≤ {m} m.', 'अचूकता ≤ {m} मी असलेला ताजा GPS हवा.', 'सटीकता ≤ {m} मी वाला ताज़ा GPS चाहिए.'],
  'drv.arriveHint': ['Unlocks automatically when GPS shows you within {m} m of the destination.', 'GPS नुसार तुम्ही ठिकाणापासून {m} मी आत आल्यावर आपोआप सुरू होईल.', 'GPS से आप मंज़िल के {m} मी अंदर होंगे तो अपने आप खुलेगा.'],
  'drv.endHint': ['All deliveries recorded. Ending stops location sharing.', 'सर्व डिलिव्हरी नोंदवल्या. फेरी संपवल्यावर स्थान पाठवणे बंद होईल.', 'सभी डिलीवरी दर्ज. खत्म करने पर लोकेशन भेजना बंद होगा.'],
  'drv.ended': ['Trip ended. Awaiting operator verification.', 'फेरी संपली. अधिकाऱ्याच्या पडताळणीची वाट.', 'फेरा खत्म. अधिकारी की जाँच बाकी.'],
  'drv.destination': ['Destination', 'ठिकाण', 'मंज़िल'],
  'drv.stopOf': ['stop {a} of {b}', 'थांबा {a} / {b}', 'पड़ाव {a} / {b}'],
  'drv.distance': ['Distance (GPS)', 'अंतर (GPS)', 'दूरी (GPS)'],
  'drv.deliver': ['Deliver', 'द्यायचे पाणी', 'देना है'],
  'drv.navigate': ['Open navigation', 'नकाशा उघडा', 'नेविगेशन खोलें'],
  'drv.voiceCmd': ['Voice command', 'आवाजाने आदेश', 'आवाज़ से आदेश'],
  'drv.voiceHint': ['Say “accept”, “start”, “confirm” or “end”', '“स्वीकार”, “सुरू”, “खात्री” किंवा “संपवा” म्हणा', '“स्वीकार”, “शुरू”, “पुष्टि” या “खत्म” बोलें'],
  'drv.voiceUnknown': ['Did not understand “{t}”.', '“{t}” समजले नाही.', '“{t}” समझ नहीं आया.'],
  'drv.speakUpdates': ['Spoken updates', 'बोलून सूचना', 'बोलकर सूचना'],
  'drv.say.assigned': ['New trip assigned. {n} stops. First stop {p}.', 'नवीन फेरी मिळाली. {n} थांबे. पहिला थांबा {p}.', 'नया फेरा मिला. {n} पड़ाव. पहला पड़ाव {p}.'],
  'drv.say.started': ['Trip started. Drive to {p}.', 'फेरी सुरू. {p} कडे चला.', 'फेरा शुरू. {p} की ओर चलें.'],
  'drv.say.arrived': ['You have arrived at {p}. Confirm arrival.', 'तुम्ही {p} येथे पोहोचलात. खात्री करा.', 'आप {p} पहुँच गए. पुष्टि करें.'],
  'drv.say.delivered': ['Delivery recorded.', 'डिलिव्हरी नोंदवली.', 'डिलीवरी दर्ज हुई.'],
  'drv.gps': ['GPS', 'GPS', 'GPS'],
  'drv.task.Assigned': ['New trip to {p}', '{p} साठी नवीन फेरी', '{p} के लिए नया फेरा'],
  'drv.task.Accepted': ['Ready to start for {p}', '{p} साठी सुरू करायला तयार', '{p} के लिए शुरू करने को तैयार'],
  'drv.task.En Route': ['Drive to {p}', '{p} कडे चला', '{p} की ओर चलें'],
  'drv.task.Arrived': ['You are at {p}', 'तुम्ही {p} येथे आहात', 'आप {p} पर हैं'],
  'drv.task.Delivering': ['Hand over the water at {p}', '{p} येथे पाणी द्या', '{p} पर पानी सौंपें'],
  'drv.task.Delivered': ['Delivery recorded', 'डिलिव्हरी नोंदवली', 'डिलीवरी दर्ज हुई'],
  'drv.task.ended': ['Trip finished', 'फेरी संपली', 'फेरा खत्म'],
  'drv.away': ['{d} away', '{d} दूर', '{d} दूर'],
  'drv.unlocks': ['Unlocks automatically within {m} m', '{m} मी आत आल्यावर आपोआप सुरू', '{m} मी के अंदर अपने आप खुलेगा'],
  'drv.menu': ['Menu', 'मेनू', 'मेनू'],
  'drv.signout': ['Sign out', 'बाहेर पडा', 'साइन आउट'],
  'drv.stops': ['Stops', 'थांबे', 'पड़ाव'],
  'drv.sending': ['Sharing location', 'स्थान पाठवत आहे', 'लोकेशन भेज रहे हैं'],
  'drv.notSending': ['Location is shared only after START', 'START नंतरच स्थान पाठवले जाते', 'START के बाद ही लोकेशन भेजी जाती है'],
  'drv.details': ['Details', 'तपशील', 'विवरण'],
  'drv.source': ["Tracking source: this phone's GPS", 'स्थान स्रोत: या फोनचा GPS', 'लोकेशन स्रोत: इस फ़ोन का GPS'],
  'drv.position': ['Position', 'स्थान', 'स्थान'],
  'drv.fixTime': ['Fix time', 'वेळ', 'समय'],
  'drv.ago': ['{s}s ago', '{s} से. आधी', '{s} से. पहले'],
  'drv.trip': ['Trip', 'फेरी', 'फेरा'],
  'drv.arrivalToast': ['Arrival detected', 'पोहोचल्याची नोंद', 'पहुँचने की पुष्टि'],
  'drv.arrivalToastBody': ['GPS confirms you are at {p}.', 'GPS नुसार तुम्ही {p} येथे आहात.', 'GPS के अनुसार आप {p} पर हैं.'],
  'drv.started': ['Trip started', 'फेरी सुरू झाली', 'फेरा शुरू हुआ'],
  'drv.startedBody': ['Live tracking is on. Keep this screen open.', 'थेट स्थान पाठवणे सुरू आहे. ही स्क्रीन उघडी ठेवा.', 'लाइव ट्रैकिंग चालू है. यह स्क्रीन खुली रखें.'],
  'tripStatus.Planned': ['Planned', 'नियोजित', 'नियोजित'], 'tripStatus.Assigned': ['Assigned', 'दिली', 'सौंपा'],
  'tripStatus.Accepted': ['Accepted', 'स्वीकारली', 'स्वीकारा'], 'tripStatus.En Route': ['On the way', 'रस्त्यात', 'रास्ते में'],
  'tripStatus.Arrived': ['Arrived', 'पोहोचलो', 'पहुँचे'], 'tripStatus.Delivering': ['Delivering', 'पाणी देत आहे', 'पानी दे रहे'],
  'tripStatus.Delivered': ['Delivered', 'दिले', 'दे दिया'], 'tripStatus.Completed': ['Completed', 'पूर्ण', 'पूरा'], 'tripStatus.Cancelled': ['Cancelled', 'रद्द', 'रद्द'],
  'drv.gpsOk': ['Fix OK', 'GPS ठीक', 'GPS ठीक'],
  'drv.gpsOld': ['Old fix', 'जुना GPS', 'पुराना GPS'],
  'drv.gpsSearching': ['Searching…', 'शोधत आहे…', 'खोज रहे हैं…'],
  'drv.gpsError': ['Error', 'त्रुटी', 'त्रुटि'],
  'drv.accuracy': ['Accuracy', 'अचूकता', 'सटीकता'],
  'drv.lastSent': ['Last sent', 'शेवटचे पाठवले', 'आखिरी बार भेजा'],
  'drv.buffered': ['Kept on phone', 'फोनवर ठेवले', 'फ़ोन पर रखे'],
  'drv.noConn': ['No connection. Fixes are kept on this phone and sent when back online.', 'नेटवर्क नाही. GPS नोंदी फोनवर ठेवल्या जातील व नंतर पाठवल्या जातील.', 'नेटवर्क नहीं. GPS रिकॉर्ड फ़ोन पर रहेंगे और बाद में भेजे जाएँगे.'],
  'drv.step.Assigned': ['Accept', 'स्वीकार', 'स्वीकार'],
  'drv.step.Accepted': ['Start', 'सुरू', 'शुरू'],
  'drv.step.En Route': ['On the way', 'रस्त्यात', 'रास्ते में'],
  'drv.step.Arrived': ['Arrived', 'पोहोचलो', 'पहुँचे'],
  'drv.step.Delivering': ['Delivering', 'पाणी देत आहे', 'पानी दे रहे'],
  'drv.step.Delivered': ['Done', 'झाले', 'हो गया'],
  'drv.record': ['Record delivery', 'डिलिव्हरी नोंदवा', 'डिलीवरी दर्ज करें'],
  'drv.litres': ['Litres delivered (from meter)', 'दिलेले लिटर (मीटरवरून)', 'दिए गए लीटर (मीटर से)'],
  'drv.receiver': ['Receiver / authorised representative', 'पाणी घेणारी व्यक्ती', 'पानी लेने वाला व्यक्ति'],
  'drv.receiverPhone': ['Receiver phone (optional)', 'त्यांचा फोन (ऐच्छिक)', 'उनका फ़ोन (वैकल्पिक)'],
  'drv.photo': ['Photo of meter / handover (optional)', 'मीटरचा फोटो (ऐच्छिक)', 'मीटर की फ़ोटो (वैकल्पिक)'],
  'drv.notes': ['Notes (optional)', 'टीप (ऐच्छिक)', 'नोट (वैकल्पिक)'],
  'drv.signature': ['Receiver signature (optional)', 'सही (ऐच्छिक)', 'हस्ताक्षर (वैकल्पिक)'],
  'drv.clear': ['Clear', 'पुसा', 'मिटाएँ'],
};

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const row = D[key];
  let s = row ? row[lang === 'en' ? 0 : lang === 'mr' ? 1 : 2] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const KEY = 'jalsetu_lang';
function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && ['en', 'mr', 'hi'].includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('mr') ? 'mr' : nav.startsWith('hi') ? 'hi' : 'en';
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: string, v?: Record<string, string | number>) => string }>({
  lang: 'en', setLang: () => {}, t: k => k,
});

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang === 'en' ? 'en-IN' : lang; }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t: (k: string, v?: Record<string, string | number>) => translate(lang, k, v) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useLang = () => useContext(Ctx);
