# Curriculum

What a learner can do at each CEFR band, for any target language.

This directory holds the authored curriculum. It is prose plus one data file per
band; the shipped competency inventory is generated from these and never
hand-edited.

    README.md    this file. Reference. Never parsed.
    a1.json      the A1 band: lessons and competencies. Language-neutral.

The phrases that realize a competency in a particular language are NOT here.
They live with that language's data, because a competency is language-neutral
and only its realizations are not.

## The shape of a band file

    {
      "schemaVersion": "1",
      "band": "A1",
      "lessons": [
        { "lessonId": "social-contact", "ordinal": 1, "displayName": "Social Contact" }
      ],
      "competencies": [
        { "competencyId": "greet",
          "lessonId": "social-contact",
          "displayName": "Greet",
          "cefrDescriptor": "Can greet someone and respond to a greeting." }
      ]
    }

`A1.1` is not stored anywhere. It is the band plus the lesson's ordinal, and
writing it as a string would mean renumbering a lesson edits text other things
parse.

Ids are authored, not derived. Nothing mechanical gets from "Give a basic
greeting" to `greet`, and the id is what the Teacher reads: the prompt that
ships this curriculum drops the descriptors, because at this many competencies
they are most of its length. So an id has to say what the competency is on its
own. `ask-price` does; `c14b` and `buy-2` do not.

**An id is permanent once it ships.** Learner cards and teach records are
written against it, so renaming one orphans a player's history.

---

## Hierarchy

```text
CEFR level
    Competency domain
        Competency
            Atomic skill
                Evidence criteria
                Required language features
                Practice contexts
                Assessment prompts
```

Example:

```text
A1
    Spoken interaction
        Exchange personal information
            Ask someone's name
                Evidence:
                    Learner independently asks a comprehensible
                    question requesting the other person's name.

                Language features:
                    the question form for asking a name
                    the verb the language uses for being called
                    whatever formality distinction the language makes
                    when addressing a stranger

                Practice contexts:
                    Meeting an NPC
                    Checking a passenger list
                    Introducing two characters

                Assessment:
                    "You have just met Leanne. Find out her name."
```

Language features are described by their JOB, not by their form. "The question
form for asking a name" is answerable in every language; `¿Cómo te llamas?` is
answerable in one. A language that marks formality differently, or not at all,
still satisfies the same competency.

The atomic skill -- not a broad category such as "Introductions" -- is the unit
that can be assessed, practiced, mastered, forgotten, and reassessed.

---

## Competency Domains

1. Listening comprehension
2. Reading comprehension
3. Spoken interaction
4. Spoken production
5. Written interaction
6. Written production
7. Communicative strategies
8. Linguistic resources

**Linguistic resources** include grammar, vocabulary, pronunciation, discourse
markers, and sociolinguistic knowledge. These support communication but should
not replace communicative competencies.

For example:

- **Linguistic skill:** Use the language's ordinary present tense.
- **Communicative competency:** Describe an ordinary daily routine.

### Which domains a band file covers

A competency has to be something an NPC can say, that lights up on the page, and
that credits a card when the learner engages with it. That rules two domains out
of the band files for now, and the reason is mechanical rather than pedagogical:

- **Listening** needs audio, and there is none. Everything is text.
- **Written production** needs a surface for the player to write into that is
  not a conversation turn -- a form, a list, a note. There is none.

Reading is different again: everything on screen is read, so "understand a
short sign" is not distinguishable from playing. Its genuinely separate items --
a timetable, a menu, a sign -- live in the topical lesson they belong to.

**Communicative strategies stay**, as the Repair lesson. A beginner has to be
able to hold a conversation without already knowing everything, and that is the
lesson that lets them.

---

## Linguistic Resources at each band

The grammar, pragmatics and sound-discrimination a learner needs to perform the
competencies. These are **per language** and are not listed here -- what follows
is the set of QUESTIONS each language answers for itself, so that two languages
can be compared without one being described in the other's terms.

A language's own answers belong with that language's data, not in this file.

### Grammar

- How does the language mark person on a verb, and may the subject be omitted?
- Does it distinguish formal and familiar address, and how?
- Does it mark gender, number, or case, and where must that agree?
- How are definite and indefinite reference expressed, if at all?
- What is the ordinary present tense a beginner needs first?
- Which of the highest-frequency verbs are irregular in that tense?
- How are being, having, location, and existence expressed? These are often
  separate verbs and are often irregular.
- How is negation formed?
- How are yes/no questions formed, and what are the question words?
- How are possession and demonstratives expressed?
- How is spatial relation expressed -- prepositions, cases, postpositions?
- How is the nearest future expressed without a full future tense?
- How are frequency, quantity, numbers, dates and times expressed?

### Pragmatics

- How does greeting change with the time of day or the relationship?
- How is politeness marked, and what is the cost of getting it wrong?
- How is a request softened so it is not a bare command?
- How does a speaker signal they have not understood, without losing face?
- How is a stranger's attention gained politely?
- What conventionally opens and closes a conversation?

### Sound and Listening Discrimination

- Which vowel or consonant contrasts does a beginner most often confuse?
- Where does stress fall, and does it change meaning?
- How does intonation mark a question?
- Which letters or clusters are silent, or pronounced unlike their spelling?
- Where do words run together in ordinary speech, and which contractions and
  reductions must a learner recognize by ear?

---

## Design Principles

1. **Language progression remains independent from story progression.**
2. **The same quest and narrative content must support multiple learner levels.**
3. **CEFR level is a summary, not the learner's complete state.**
4. **Atomic competencies are the assessable and trainable units.**
5. **Grammar supports communication; it is not the primary curriculum structure.**
6. **A competency may be practiced in many unrelated scenes and contexts.**
7. **A single conversation may exercise several competencies.**
8. **Assessment should measure independent use, not only recognition.**
9. **Communication-repair skills should be taught from the beginning.**
10. **Competency mastery should decay or require periodic confirmation over time.**
11. **A competency is language-neutral; only its realizations are not.**
12. **One ability is one competency.** Recognizing a greeting and giving one are
    the same competency: there is no separate receptive score for them to differ
    on, and two competencies for one ability means two cards for one skill --
    the learner either gets double credit or one card never fires and shows as
    due forever.
