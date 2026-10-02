"""Bootstrap training corpus for complaint triage.

There is no public, labelled corpus of Indian water-supply grievances, so the first model
is trained on a compositional corpus: category phrases x severity cues x duration x
location x noise, in English, Hinglish, Hindi (Devanagari) and Marathi.  The phrase
banks are split into *train* and *holdout* halves so the reported test score measures
generalisation to unseen phrasings, not template memorisation.

Labels follow the municipal triage policy encoded in ``label_severity``.  Once officers
start confirming/correcting categories in the app, ``train.py --db-url`` mixes those real
labelled complaints in and they progressively dominate the training signal.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

import pandas as pd

# ---------------------------------------------------------------------------
# Phrase banks.  Each category has a list per language; entries are split
# deterministically into train/holdout by index parity.
# ---------------------------------------------------------------------------
CATEGORY_PHRASES: dict[str, dict[str, list[str]]] = {
    "No Water": {
        "en": [
            "there is no water supply in our area",
            "taps are completely dry",
            "no water coming in the common tap",
            "water supply has stopped",
            "we have not received any water",
            "the pipeline is dry and nobody is coming",
            "not a single drop of water in the standpost",
            "water has been cut off without notice",
            "our building has zero water",
            "main line burst and supply is stopped",
            "the well and taps both are empty, no supply",
            "no water at the community tank",
        ],
        "hi_latn": [
            "pani nahi aa raha hai",
            "nal mein ek boond pani nahi hai",
            "humare area mein paani band hai",
            "pani ki supply bilkul band hai",
            "line sukhi padi hai, paani nahi",
            "tanki khaali hai aur pani nahi aaya",
            "pipeline toot gayi hai paani band",
            "koi paani nahi mila abhi tak",
        ],
        "hi": [
            "पानी नहीं आ रहा है",
            "नल में बिल्कुल पानी नहीं है",
            "हमारे इलाके में पानी की सप्लाई बंद है",
            "पाइपलाइन सूखी पड़ी है",
            "टंकी खाली है, पानी नहीं मिला",
            "पानी पूरी तरह बंद कर दिया गया है",
        ],
        "mr": [
            "पाणी येत नाही",
            "नळाला अजिबात पाणी नाही",
            "आमच्या भागात पाणीपुरवठा बंद आहे",
            "टाकी रिकामी आहे, पाणी आलेच नाही",
            "पाईपलाईन फुटली आहे आणि पाणी बंद आहे",
            "एक थेंबही पाणी मिळाले नाही",
        ],
    },
    "Late Tanker": {
        "en": [
            "the tanker is late again",
            "tanker was supposed to come at 9 but has not arrived",
            "we are waiting for the tanker since morning",
            "tanker delayed by many hours",
            "the water tanker always comes very late",
            "tanker schedule is not followed, still waiting",
            "the driver said he is coming but tanker is still not here",
            "tanker arrival time keeps getting delayed",
            "promised tanker has not reached yet",
            "we have been standing in line, the tanker is late",
        ],
        "hi_latn": [
            "tanker abhi tak nahi aaya",
            "tanker bahut late aata hai",
            "subah se tanker ka intezaar kar rahe hain",
            "tanker ka time 10 baje tha, ab tak nahi pahuncha",
            "tanker wala roz der se aata hai",
            "driver bol raha aa raha hu par tanker nahi aaya",
        ],
        "hi": [
            "टैंकर अभी तक नहीं आया",
            "टैंकर रोज़ देर से आता है",
            "सुबह से टैंकर का इंतज़ार कर रहे हैं",
            "टैंकर का समय निकल गया पर आया नहीं",
            "टैंकर कई घंटे लेट है",
        ],
        "mr": [
            "टँकर अजून आला नाही",
            "टँकर नेहमी उशिरा येतो",
            "सकाळपासून टँकरची वाट पाहत आहोत",
            "टँकरची वेळ होऊन गेली तरी आला नाही",
            "टँकर खूप उशिरा आला",
        ],
    },
    "Insufficient Quantity": {
        "en": [
            "the tanker gave only half the water",
            "water quantity is not enough for the families",
            "we got very little water, not sufficient",
            "only a few buckets were filled before the tanker left",
            "tanker was half empty when it arrived",
            "supply pressure is so low we get only a trickle",
            "allotted quantity is much less than promised",
            "water finished before everyone in the queue could fill",
            "we received less than the scheduled litres",
            "low pressure, the tank does not fill",
        ],
        "hi_latn": [
            "pani bahut kam aaya",
            "tanker aadha khaali tha",
            "sirf do balti pani mila",
            "pressure bahut kam hai, pani thoda thoda aata hai",
            "sabko pani nahi mila, kam pad gaya",
            "jitna bola tha usse kam pani diya",
        ],
        "hi": [
            "पानी बहुत कम मिला",
            "टैंकर आधा खाली था",
            "सिर्फ दो बाल्टी पानी मिला",
            "प्रेशर बहुत कम है, पानी थोड़ा आता है",
            "सबको पानी नहीं मिला, कम पड़ गया",
        ],
        "mr": [
            "पाणी खूप कमी मिळाले",
            "टँकर अर्धा रिकामा होता",
            "फक्त दोन बादल्या पाणी मिळाले",
            "दाब कमी आहे, पाणी थोडेच येते",
            "सगळ्यांना पाणी पुरले नाही",
        ],
    },
    "Poor Water Quality": {
        "en": [
            "the water is dirty and muddy",
            "water smells like sewage",
            "yellow coloured water is coming from the tap",
            "there are worms in the drinking water",
            "water tastes salty and bitter",
            "the tanker water looks contaminated",
            "brown water with sediment is being supplied",
            "water has a strong chemical smell",
            "drinking water is unsafe, looks muddy",
            "foul smell from tap water since the pipe repair",
        ],
        "hi_latn": [
            "pani ganda aa raha hai",
            "nal se mitti wala pani aa raha hai",
            "pani mein badbu aa rahi hai",
            "peela pani aa raha hai",
            "pani mein keede hain",
            "tanker ka pani bilkul ganda tha",
        ],
        "hi": [
            "पानी गंदा आ रहा है",
            "नल से मटमैला पानी आ रहा है",
            "पानी में बदबू आ रही है",
            "पानी में कीड़े हैं",
            "पीला पानी आ रहा है",
        ],
        "mr": [
            "पाणी गढूळ येत आहे",
            "पाण्याला घाण वास येतो",
            "पिवळे पाणी येत आहे",
            "पाण्यात किडे आहेत",
            "टँकरचे पाणी खराब होते",
        ],
    },
    "Missed Delivery": {
        "en": [
            "the tanker skipped our lane completely",
            "tanker came to the next society but missed us",
            "our scheduled delivery was missed",
            "the tanker never came on the scheduled day",
            "driver went to another colony and did not visit us",
            "our name was on the list but no delivery happened",
            "the route skipped our standpost today",
            "delivery was marked done but tanker never came here",
        ],
        "hi_latn": [
            "tanker humari gali mein aaya hi nahi",
            "tanker bagal wali society mein gaya, humein chhod diya",
            "list mein naam tha par delivery nahi hui",
            "tanker ne humara stop skip kar diya",
            "delivery done likha hai par tanker aaya hi nahi",
        ],
        "hi": [
            "टैंकर हमारी गली में आया ही नहीं",
            "टैंकर बगल की सोसाइटी में गया, हमें छोड़ दिया",
            "सूची में नाम था पर डिलीवरी नहीं हुई",
            "टैंकर ने हमारा स्टॉप छोड़ दिया",
        ],
        "mr": [
            "टँकर आमच्या गल्लीत आलाच नाही",
            "टँकर शेजारच्या सोसायटीत गेला, आम्हाला सोडले",
            "यादीत नाव होते पण पाणी पोहोचवले नाही",
            "टँकरने आमचा थांबा वगळला",
        ],
    },
    "Billing or Other": {
        "en": [
            "I want to know the tanker schedule for next week",
            "please update my registered mobile number",
            "how do I apply for a new water connection",
            "water bill amount seems wrong",
            "requesting information about the water timetable",
            "the tap near the school is leaking",
            "driver asked for extra money for water",
            "please share the contact number of the ward officer",
            "pipe leakage on the road, water is being wasted",
            "need status update of my earlier request",
        ],
        "hi_latn": [
            "agle hafte ka tanker schedule batayein",
            "naya connection kaise milega",
            "pani ka bill galat aaya hai",
            "road par pipe leak ho raha hai",
            "driver extra paise maang raha tha",
            "ward officer ka number chahiye",
        ],
        "hi": [
            "अगले हफ्ते का टैंकर शेड्यूल बताइए",
            "नया कनेक्शन कैसे मिलेगा",
            "पानी का बिल गलत आया है",
            "सड़क पर पाइप लीक हो रहा है",
        ],
        "mr": [
            "पुढच्या आठवड्याचे टँकर वेळापत्रक सांगा",
            "नवीन नळ जोडणी कशी मिळेल",
            "पाण्याचे बिल चुकीचे आले आहे",
            "रस्त्यावर पाईप गळती आहे",
        ],
    },
}

# Cues that escalate to Critical regardless of category (public-health / safety signals).
CRITICAL_CUES: dict[str, list[str]] = {
    "en": [
        "children are falling sick",
        "elderly people are suffering",
        "people are getting diarrhoea",
        "the local clinic has no water",
        "the hospital ward needs water urgently",
        "this is an emergency",
        "residents are planning a protest",
        "pregnant women in the area are struggling",
        "several people have vomiting and fever",
        "the school toilets cannot be used",
    ],
    "hi_latn": [
        "bachche beemar pad rahe hain",
        "buzurg log pareshan hain",
        "logon ko ulti dast ho rahe hain",
        "yeh emergency hai",
        "log andolan karne wale hain",
        "dispensary mein bhi pani nahi hai",
    ],
    "hi": [
        "बच्चे बीमार पड़ रहे हैं",
        "बुजुर्ग परेशान हैं",
        "लोगों को उल्टी-दस्त हो रहे हैं",
        "यह आपातकाल है",
        "दवाखाने में भी पानी नहीं है",
    ],
    "mr": [
        "मुले आजारी पडत आहेत",
        "वृद्ध लोकांचे हाल होत आहेत",
        "लोकांना जुलाब उलट्या होत आहेत",
        "ही आणीबाणी आहे",
        "दवाखान्यातही पाणी नाही",
    ],
}

LOW_CUES: dict[str, list[str]] = {
    "en": ["just for information", "not urgent", "whenever possible", "minor issue", "routine query"],
    "hi_latn": ["sirf jaankari ke liye", "urgent nahi hai", "jab time mile", "chhoti si baat hai"],
    "hi": ["सिर्फ जानकारी के लिए", "जल्दी नहीं है", "छोटी सी समस्या है"],
    "mr": ["फक्त माहितीसाठी", "तातडीचे नाही", "छोटी अडचण आहे"],
}

DURATION_TEMPLATES: dict[str, list[str]] = {
    "en": ["for {n} days", "since {n} days", "for the last {n} days", "it has been {n} days", "{n} days now"],
    "hi_latn": ["{n} din se", "pichhle {n} din se", "{n} din ho gaye"],
    "hi": ["{n} दिन से", "पिछले {n} दिनों से", "{n} दिन हो गए"],
    "mr": ["{n} दिवसांपासून", "गेले {n} दिवस", "{n} दिवस झाले"],
}
TODAY_TEMPLATES: dict[str, list[str]] = {
    "en": ["today", "this morning", "since yesterday night"],
    "hi_latn": ["aaj", "aaj subah se", "kal raat se"],
    "hi": ["आज", "आज सुबह से", "कल रात से"],
    "mr": ["आज", "आज सकाळपासून", "काल रात्रीपासून"],
}

OPENERS: dict[str, list[str]] = {
    "en": ["", "Sir,", "Respected officer,", "Hello,", "Complaint:", "Dear team,", "Please help."],
    "hi_latn": ["", "Sir,", "Namaste,", "Sahab,", "Shikayat:"],
    "hi": ["", "महोदय,", "नमस्ते,", "शिकायत:"],
    "mr": ["", "साहेब,", "नमस्कार,", "तक्रार:"],
}
CLOSERS: dict[str, list[str]] = {
    "en": ["", "Please do something.", "Kindly resolve.", "Please send tanker.", "Thank you.", "Help us."],
    "hi_latn": ["", "jaldi kuch kijiye", "please madad karo", "dhanyavaad"],
    "hi": ["", "कृपया जल्दी कुछ करें।", "मदद कीजिए।", "धन्यवाद।"],
    "mr": ["", "कृपया लवकर काहीतरी करा.", "मदत करा.", "धन्यवाद."],
}
LOCATIONS = [
    "Shivaji Nagar", "Govandi", "Mankhurd", "Dharavi", "Kurla East", "Chembur", "Sion",
    "Wadala", "Bandra East", "Vikhroli", "lane 4", "building no 12", "the slum near the nala",
    "Sector 3", "the chawl", "Ambedkar Nagar", "Indira colony",
]

BASE_SEVERITY = {
    "No Water": 2,              # High
    "Late Tanker": 1,           # Medium
    "Insufficient Quantity": 1,
    "Poor Water Quality": 2,
    "Missed Delivery": 2,
    "Billing or Other": 0,      # Low
}
SEVERITIES = ["Low", "Medium", "High", "Critical"]


def label_severity(category: str, days: int | None, critical: bool, low: bool) -> str:
    """Municipal triage policy used to label the bootstrap corpus."""
    if critical:
        return "Critical"
    level = BASE_SEVERITY[category]
    if days is not None and days >= 3:
        level += 1
    if days is not None and days >= 5:
        level += 1
    if low:
        level -= 1
    return SEVERITIES[max(0, min(3, level))]


@dataclass
class Sample:
    text: str
    category: str
    severity: str
    language: str


def _split(items: list[str], holdout: bool) -> list[str]:
    """Deterministic phrase-bank split: odd indices are held out (if there are enough)."""
    if len(items) < 3:
        return items
    return [p for i, p in enumerate(items) if (i % 3 == 2) == holdout]


def _typo(text: str, rng: random.Random) -> str:
    if len(text) < 8 or rng.random() > 0.25:
        return text
    chars = list(text)
    i = rng.randrange(1, len(chars) - 1)
    op = rng.random()
    if op < 0.4:
        chars[i], chars[i + 1 if i + 1 < len(chars) else i] = chars[i + 1 if i + 1 < len(chars) else i], chars[i]
    elif op < 0.7:
        del chars[i]
    else:
        chars.insert(i, chars[i])
    return "".join(chars)


def generate(n: int = 12000, holdout: bool = False, seed: int = 7) -> pd.DataFrame:
    rng = random.Random(seed + (1000 if holdout else 0))
    languages = ["en", "hi_latn", "hi", "mr"]
    lang_weights = [0.45, 0.25, 0.15, 0.15]
    categories = list(CATEGORY_PHRASES)
    samples: list[Sample] = []

    for _ in range(n):
        lang = rng.choices(languages, lang_weights)[0]
        cat = rng.choice(categories)
        core = rng.choice(_split(CATEGORY_PHRASES[cat][lang], holdout))

        critical = cat != "Billing or Other" and rng.random() < 0.18
        low = not critical and rng.random() < 0.15

        days: int | None = None
        r = rng.random()
        parts: list[str] = []
        if cat != "Billing or Other" and r < 0.55:
            days = rng.choice([1, 2, 2, 3, 3, 4, 5, 6, 7, 10])
            word = str(days) if lang != "en" or rng.random() < 0.7 else ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][min(days, 10) - 1]
            parts.append(rng.choice(DURATION_TEMPLATES[lang]).format(n=word))
        elif cat != "Billing or Other" and r < 0.75:
            days = 0
            parts.append(rng.choice(TODAY_TEMPLATES[lang]))

        sentence = [rng.choice(OPENERS[lang])]
        if rng.random() < 0.5:
            loc = rng.choice(LOCATIONS)
            sentence.append({"en": f"In {loc},", "hi_latn": f"{loc} mein", "hi": f"{loc} में", "mr": f"{loc} मध्ये"}[lang])
        if parts and rng.random() < 0.5:
            sentence.append(parts.pop())
        sentence.append(core)
        if parts:
            sentence.append(parts.pop())
        if critical:
            sentence.append(rng.choice(_split(CRITICAL_CUES[lang], holdout)))
        if low:
            sentence.append(rng.choice(LOW_CUES[lang]))
        sentence.append(rng.choice(CLOSERS[lang]))

        text = " ".join(s for s in sentence if s).strip()
        if lang in ("en", "hi_latn"):
            if rng.random() < 0.3:
                text = text.lower()
            elif rng.random() < 0.08:
                text = text.upper()
            text = _typo(text, rng)

        samples.append(Sample(text, cat, label_severity(cat, days, critical, low), lang))

    return pd.DataFrame([s.__dict__ for s in samples])
