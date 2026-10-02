// =====================================================
// VIBECASH FOOD GAME SERVER
// RENDER + NODE.JS + EXPRESS + FIREBASE ADMIN
// SERVER AUTHORITATIVE VERSION
// =====================================================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");


// =====================================================
// EXPRESS
// =====================================================

const app = express();

app.use(cors());

app.use(
    express.json({
        limit: "1mb"
    })
);


// =====================================================
// ENVIRONMENT
// =====================================================

const PORT =
    process.env.PORT || 10000;

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

const FIREBASE_SERVICE_ACCOUNT =
    process.env.FIREBASE_SERVICE_ACCOUNT;


// =====================================================
// ENV CHECK
// =====================================================

if (!FIREBASE_DATABASE_URL) {

    console.error(
        "FIREBASE_DATABASE_URL is missing"
    );

    process.exit(1);
}


if (!FIREBASE_SERVICE_ACCOUNT) {

    console.error(
        "FIREBASE_SERVICE_ACCOUNT is missing"
    );

    process.exit(1);
}


// =====================================================
// SERVICE ACCOUNT
// =====================================================

let serviceAccount;

try {

    serviceAccount =
        JSON.parse(
            FIREBASE_SERVICE_ACCOUNT
        );

} catch (error) {

    console.error(
        "Invalid FIREBASE_SERVICE_ACCOUNT JSON"
    );

    console.error(
        error.message
    );

    process.exit(1);
}


if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
) {

    console.error(
        "Firebase service account is incomplete"
    );

    process.exit(1);
}


serviceAccount.private_key =
    String(
        serviceAccount.private_key
    ).replace(
        /\\n/g,
        "\n"
    );


// =====================================================
// FIREBASE ADMIN
// =====================================================

try {

    admin.initializeApp({

        credential:
            admin.credential.cert(
                serviceAccount
            ),

        databaseURL:
            FIREBASE_DATABASE_URL

    });

} catch (error) {

    console.error(
        "Firebase initialization failed"
    );

    console.error(
        error
    );

    process.exit(1);
}


const db =
    admin.database();


// =====================================================
// GAME CONFIG
// =====================================================

const BET_DURATION =
    30 * 1000;

const SPIN_DURATION =
    5 * 1000;

const SHOW_DURATION =
    4 * 1000;


// =====================================================
// FOOD CONFIG
// =====================================================

const FOODS = [

    {
        index: 0,
        key: "apple",
        name: "Apple",
        multiplier: 5,
        weight: 20
    },

    {
        index: 1,
        key: "mango",
        name: "Mango",
        multiplier: 5,
        weight: 20
    },

    {
        index: 2,
        key: "strawberry",
        name: "Strawberry",
        multiplier: 5,
        weight: 20
    },

    {
        index: 3,
        key: "lemon",
        name: "Lemon",
        multiplier: 5,
        weight: 20
    },

    {
        index: 4,
        key: "fish",
        name: "Fish",
        multiplier: 10,
        weight: 8
    },

    {
        index: 5,
        key: "burger",
        name: "Burger",
        multiplier: 15,
        weight: 5
    },

    {
        index: 6,
        key: "pizza",
        name: "Pizza",
        multiplier: 25,
        weight: 4
    },

    {
        index: 7,
        key: "chicken",
        name: "Chicken",
        multiplier: 45,
        weight: 3
    }

];


// =====================================================
// SERVER TIME
// =====================================================

function now() {

    return Date.now();

}


// =====================================================
// GET FOOD BY KEY
// =====================================================

function getFoodByKey(key) {

    if (
        key === undefined ||
        key === null
    ) {

        return null;
    }


    const cleanKey =
        String(key)
            .trim()
            .toLowerCase();


    return (
        FOODS.find(
            food =>
                food.key === cleanKey
        ) || null
    );
}


// =====================================================
// NORMALIZE FOOD INPUT
// =====================================================

function normalizeFoodInput(body) {

    if (!body) {

        return "";
    }


    let input = "";


    if (
        body.food !== undefined &&
        body.food !== null &&
        String(body.food).trim() !== ""
    ) {

        input =
            body.food;

    } else if (
        body.foodKey !== undefined &&
        body.foodKey !== null &&
        String(body.foodKey).trim() !== ""
    ) {

        input =
            body.foodKey;

    } else if (
        body.foodName !== undefined &&
        body.foodName !== null &&
        String(body.foodName).trim() !== ""
    ) {

        input =
            body.foodName;
    }


    if (!input) {

        return "";
    }


    const value =
        String(input)
            .trim()
            .toLowerCase();


    const nameMap = {

        apple: "apple",

        mango: "mango",

        strawberry:
            "strawberry",

        lemon: "lemon",

        fish: "fish",

        burger: "burger",

        pizza: "pizza",

        chicken: "chicken"

    };


    return (
        nameMap[value] ||
        value
    );
}


// =====================================================
// WEIGHTED WINNER
// =====================================================

function chooseWeightedFood() {

    let totalWeight = 0;


    for (
        const food of FOODS
    ) {

        totalWeight +=
            Number(food.weight);

    }


    let roll =
        Math.random() *
        totalWeight;


    for (
        const food of FOODS
    ) {

        roll -=
            Number(food.weight);


        if (
            roll <= 0
        ) {

            return food;
        }

    }


    return FOODS[0];
}


// =====================================================
// VERIFY FIREBASE USER
// =====================================================

async function verifyUser(req) {

    const authorization =
        req.headers.authorization;


    if (!authorization) {

        throw new Error(
            "Authorization token missing"
        );
    }


    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {

        throw new Error(
            "Invalid authorization header"
        );
    }


    const token =
        authorization.substring(7);


    if (!token) {

        throw new Error(
            "Authorization token missing"
        );
    }


    return await admin
        .auth()
        .verifyIdToken(
            token
        );
}


// =====================================================
// PER USER LOCK
// =====================================================

const userLocks =
    new Map();


async function withUserLock(
    uid,
    work
) {

    while (
        userLocks.has(uid)
    ) {

        try {

            await userLocks.get(uid);

        } catch (e) {

            // ignore

        }

    }


    let release;


    const lockPromise =
        new Promise(
            resolve => {

                release =
                    resolve;

            }
        );


    userLocks.set(
        uid,
        lockPromise
    );


    try {

        return await work();

    } finally {

        userLocks.delete(uid);

        release();

    }
}


// =====================================================
// CREATE NEW ROUND
// =====================================================

async function createNewRound() {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );


    const result =
        await currentRef.transaction(

            current => {

                const currentTime =
                    now();


                // -----------------------------------------
                // ACTIVE ROUND
                // -----------------------------------------

                if (
                    current &&
                    current.roundId &&
                    Number(
                        current.endAt
                    ) > currentTime
                ) {

                    return current;

                }


                // -----------------------------------------
                // NEW ROUND
                // -----------------------------------------

                const roundId =
                    String(
                        currentTime
                    );


                const startAt =
                    currentTime + 1000;


                const betEndAt =
                    startAt +
                    BET_DURATION;


                const spinEndAt =
                    betEndAt +
                    SPIN_DURATION;


                const endAt =
                    spinEndAt +
                    SHOW_DURATION;


                return {

                    roundId:
                        roundId,

                    startAt:
                        startAt,

                    betEndAt:
                        betEndAt,

                    spinEndAt:
                        spinEndAt,

                    endAt:
                        endAt,

                    phase:
                        "betting",

                    winnerIndex:
                        -1,

                    winnerKey:
                        "",

                    winnerName:
                        "",

                    winnerMultiplier:
                        0,

                    createdAt:
                        admin.database
                            .ServerValue
                            .TIMESTAMP

                };

            }

        );


    if (
        !result.committed
    ) {

        throw new Error(
            "Unable to create round"
        );

    }


    const round =
        result.snapshot.val();


    // =================================================
    // CREATE ROUND COPY
    // =================================================

    if (
        round &&
        round.roundId
    ) {

        const roundRef =
            db.ref(
                `food_game_global/rounds/${round.roundId}`
            );


        const snapshot =
            await roundRef.once(
                "value"
            );


        if (
            !snapshot.exists()
        ) {

            await roundRef.set({

                roundId:
                    round.roundId,

                startAt:
                    Number(
                        round.startAt
                    ),

                betEndAt:
                    Number(
                        round.betEndAt
                    ),

                spinEndAt:
                    Number(
                        round.spinEndAt
                    ),

                endAt:
                    Number(
                        round.endAt
                    ),

                phase:
                    "betting",

                winnerIndex:
                    -1,

                winnerKey:
                    "",

                winnerName:
                    "",

                winnerMultiplier:
                    0,

                createdAt:
                    admin.database
                        .ServerValue
                        .TIMESTAMP

            });

        }

    }


    return round;
}


// =====================================================
// GET CURRENT ROUND
// =====================================================

async function getCurrentRound() {

    const ref =
        db.ref(
            "food_game_global/current"
        );


    const snapshot =
        await ref.once(
            "value"
        );


    const round =
        snapshot.val();


    if (
        !round ||
        !round.roundId
    ) {

        return await createNewRound();

    }


    if (
        Number(
            round.endAt
        ) <= now()
    ) {

        return await createNewRound();

    }


    return round;
}


// =====================================================
// CHOOSE WINNER
// =====================================================

async function chooseWinner(
    roundId
) {

    const currentRef =
        db.ref(
            "food_game_global/current"
        );


    const randomWinner =
        chooseWeightedFood();


    const result =
        await currentRef.transaction(

            current => {

                if (!current) {

                    return;

                }


                if (
                    current.roundId !==
                    roundId
                ) {

                    return current;

                }


                if (
                    Number(
                        current.winnerIndex
                    ) >= 0
                ) {

                    return current;

                }


                current.winnerIndex =
                    randomWinner.index;


                current.winnerKey =
                    randomWinner.key;


                current.winnerName =
                    randomWinner.name;


                current.winnerMultiplier =
                    randomWinner.multiplier;


                current.phase =
                    "spin";


                return current;

            }

        );


    if (
        !result.committed
    ) {

        return null;

    }


    const finalRound =
        result.snapshot.val();


    if (
        finalRound &&
        finalRound.roundId
    ) {

        await db.ref(
            `food_game_global/rounds/${roundId}`
        ).update({

            winnerIndex:
                Number(
                    finalRound.winnerIndex
                ),

            winnerKey:
                finalRound.winnerKey,

            winnerName:
                finalRound.winnerName,

            winnerMultiplier:
                Number(
                    finalRound.winnerMultiplier
                ),

            phase:
                "spin"

        });

    }


    console.log(
        "================================="
    );

    console.log(
        "WINNER SELECTED"
    );

    console.log(
        "ROUND:",
        roundId
    );

    console.log(
        "FOOD:",
        randomWinner.name
    );

    console.log(
        "KEY:",
        randomWinner.key
    );

    console.log(
        "MULTIPLIER:",
        randomWinner.multiplier
    );

    console.log(
        "================================="
    );


    return randomWinner;
}


// =====================================================
// UPDATE ROUND PHASE
// =====================================================

async function updateRoundPhase(
    round
) {

    if (!round) {

        return;

    }


    const currentTime =
        now();


    let phase;


    if (
        currentTime <
        Number(
            round.betEndAt
        )
    ) {

        phase =
            "betting";

    } else if (
        currentTime <
        Number(
            round.spinEndAt
        )
    ) {

        phase =
            "spin";

    } else if (
        currentTime <
        Number(
            round.endAt
        )
    ) {

        phase =
            "result";

    } else {

        return;

    }


    if (
        phase !==
        round.phase
    ) {

        await db.ref(
            "food_game_global/current"
        ).update({

            phase:
                phase

        });


        await db.ref(
            `food_game_global/rounds/${round.roundId}`
        ).update({

            phase:
                phase

        });

    }
}


// =====================================================
// SAVE RESULT HISTORY
// =====================================================

async function saveResultHistory(
    round
) {

    if (
        !round ||
        !round.roundId ||
        !round.winnerKey
    ) {

        return;

    }


    const winner =
        getFoodByKey(
            round.winnerKey
        );


    if (!winner) {

        return;

    }


    const ref =
        db.ref(
            `food_game_global/result_history/${round.roundId}`
        );


    const snapshot =
        await ref.once(
            "value"
        );


    if (
        snapshot.exists()
    ) {

        return;

    }


    await ref.set({

        roundId:
            round.roundId,

        food:
            winner.key,

        foodName:
            winner.name,

        multiplier:
            winner.multiplier,

        createdAt:
            admin.database
                .ServerValue
                .TIMESTAMP

    });
}


// =====================================================
// GAME STATE
// =====================================================

app.get(
    "/game/state",
    async (
        req,
        res
    ) => {

        try {

            let round =
                await getCurrentRound();


            let currentTime =
                now();


            // =============================================
            // BETTING OVER
            // =============================================

            if (
                currentTime >=
                Number(
                    round.betEndAt
                ) &&
                Number(
                    round.winnerIndex
                ) < 0
            ) {

                await chooseWinner(
                    round.roundId
                );


                round =
                    await getCurrentRound();

            }


            // =============================================
            // UPDATE PHASE
            // =============================================

            await updateRoundPhase(
                round
            );


            // =============================================
            // READ AGAIN
            // =============================================

            round =
                await getCurrentRound();


            currentTime =
                now();


            // =============================================
            // HISTORY
            // =============================================

            if (
                Number(
                    round.winnerIndex
                ) >= 0 &&
                currentTime >=
                Number(
                    round.spinEndAt
                )
            ) {

                await saveResultHistory(
                    round
                );

            }


            // =============================================
            // RESPONSE
            // =============================================

            return res.json({

                success:
                    true,

                roundId:
                    String(
                        round.roundId
                    ),

                startAt:
                    Number(
                        round.startAt
                    ),

                betEndAt:
                    Number(
                        round.betEndAt
                    ),

                spinEndAt:
                    Number(
                        round.spinEndAt
                    ),

                endAt:
                    Number(
                        round.endAt
                    ),

                phase:
                    round.phase,

                winnerIndex:
                    Number(
                        round.winnerIndex
                    ),

                winnerKey:
                    round.winnerKey ||
                    "",

                winnerName:
                    round.winnerName ||
                    "",

                winnerMultiplier:
                    Number(
                        round.winnerMultiplier ||
                        0
                    ),

                serverTime:
                    currentTime

            });

        } catch (error) {

            console.error(
                "STATE ERROR:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get game state"

            });

        }
    }
);


// =====================================================
// PLACE BET
// =====================================================

app.post(
    "/game/bet",
    async (
        req,
        res
    ) => {

        try {

            // =============================================
            // AUTH
            // =============================================

            const decoded =
                await verifyUser(req);


            const uid =
                decoded.uid;


            // =============================================
            // AMOUNT
            // =============================================

            const rawAmount =
                req.body
                    ? req.body.amount
                    : null;


            const amount =
                Number(
                    rawAmount
                );


            if (
                !Number.isFinite(amount) ||
                !Number.isInteger(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid bet amount",

                    receivedAmount:
                        amount

                });

            }


            // =============================================
            // FOOD
            // =============================================

            const foodInput =
                normalizeFoodInput(
                    req.body
                );


            const food =
                getFoodByKey(
                    foodInput
                );


            if (!food) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Invalid food",

                    received:
                        foodInput,

                    allowedFoods:
                        FOODS.map(
                            item =>
                                item.key
                        )

                });

            }


            // =============================================
            // USER LOCK
            // =============================================

            return await withUserLock(
                uid,
                async () => {

                    // =====================================
                    // ROUND
                    // =====================================

                    const round =
                        await getCurrentRound();


                    const currentTime =
                        now();


                    // =====================================
                    // START CHECK
                    // =====================================

                    if (
                        currentTime <
                        Number(
                            round.startAt
                        )
                    ) {

                        return res.status(400).json({

                            success:
                                false,

                            error:
                                "Round has not started",

                            roundId:
                                round.roundId

                        });

                    }


                    // =====================================
                    // BET END CHECK
                    // =====================================

                    if (
                        currentTime >=
                        Number(
                            round.betEndAt
                        )
                    ) {

                        return res.status(400).json({

                            success:
                                false,

                            error:
                                "Betting closed",

                            roundId:
                                round.roundId

                        });

                    }


                    // =====================================
                    // USER REF
                    // =====================================

                    const userRef =
                        db.ref(
                            `users/${uid}`
                        );


                    // =====================================
                    // ATOMIC BET
                    // =====================================

                    let newBalance =
                        0;

                    let newBet =
                        0;


                    const transactionResult =
                        await userRef.transaction(

                            user => {

                                if (!user) {

                                    return;

                                }


                                const balance =
                                    Number(
                                        user.diamonds ||
                                        0
                                    );


                                if (
                                    !Number.isFinite(
                                        balance
                                    ) ||
                                    balance < 0
                                ) {

                                    return;

                                }


                                if (
                                    balance <
                                    amount
                                ) {

                                    return;

                                }


                                if (
                                    !user
                                        .food_game_bets
                                ) {

                                    user.food_game_bets =
                                        {};

                                }


                                if (
                                    !user
                                        .food_game_bets[
                                            round.roundId
                                        ]
                                ) {

                                    user.food_game_bets[
                                        round.roundId
                                    ] = {};

                                }


                                const oldBet =
                                    Number(
                                        user
                                            .food_game_bets[
                                                round.roundId
                                            ][
                                                food.key
                                            ] ||
                                        0
                                    );


                                newBet =
                                    oldBet +
                                    amount;


                                newBalance =
                                    balance -
                                    amount;


                                user.diamonds =
                                    newBalance;


                                user.food_game_bets[
                                    round.roundId
                                ][
                                    food.key
                                ] =
                                    newBet;


                                return user;

                            }

                        );


                    // =====================================
                    // TRANSACTION FAILED
                    // =====================================

                    if (
                        !transactionResult.committed
                    ) {

                        const checkSnapshot =
                            await userRef.once(
                                "value"
                            );


                        const checkUser =
                            checkSnapshot.val() ||
                            {};


                        const checkBalance =
                            Number(
                                checkUser.diamonds ||
                                0
                            );


                        if (
                            checkBalance <
                            amount
                        ) {

                            return res.status(400).json({

                                success:
                                    false,

                                error:
                                    "Not enough diamonds",

                                serverDiamonds:
                                    checkBalance,

                                receivedAmount:
                                    amount,

                                uid:
                                    uid,

                                roundId:
                                    round.roundId

                            });

                        }


                        return res.status(409).json({

                            success:
                                false,

                            error:
                                "Bet transaction failed",

                            roundId:
                                round.roundId

                        });

                    }


                    // =====================================
                    // MIRROR BET TO ROUND
                    // =====================================

                    const globalBetRef =
                        db.ref(
                            `food_game_global/rounds/${round.roundId}/bets/${uid}/${food.key}`
                        );


                    await globalBetRef.set(
                        newBet
                    );


                    // =====================================
                    // POSSIBLE WIN
                    // =====================================

                    const possibleWin =
                        amount *
                        food.multiplier;


                    // =====================================
                    // LOG
                    // =====================================

                    console.log(
                        "================================="
                    );

                    console.log(
                        "BET SUCCESS"
                    );

                    console.log(
                        "UID:",
                        uid
                    );

                    console.log(
                        "ROUND:",
                        round.roundId
                    );

                    console.log(
                        "FOOD:",
                        food.key
                    );

                    console.log(
                        "AMOUNT:",
                        amount
                    );

                    console.log(
                        "TOTAL FOOD BET:",
                        newBet
                    );

                    console.log(
                        "MULTIPLIER:",
                        food.multiplier
                    );

                    console.log(
                        "POSSIBLE WIN:",
                        possibleWin
                    );

                    console.log(
                        "BALANCE:",
                        newBalance
                    );

                    console.log(
                        "================================="
                    );


                    return res.json({

                        success:
                            true,

                        roundId:
                            round.roundId,

                        food:
                            food.key,

                        foodKey:
                            food.key,

                        foodName:
                            food.name,

                        amount:
                            amount,

                        receivedAmount:
                            amount,

                        totalFoodBet:
                            newBet,

                        multiplier:
                            food.multiplier,

                        possibleWin:
                            possibleWin,

                        diamonds:
                            newBalance

                    });

                }
            );


        } catch (error) {

            console.error(
                "BET ERROR:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    error.message ||
                    "Bet failed"

            });

        }
    }
);


// =====================================================
// SETTLE
// =====================================================

app.post(
    "/game/settle",
    async (
        req,
        res
    ) => {

        try {

            // =============================================
            // AUTH
            // =============================================

            const decoded =
                await verifyUser(req);


            const uid =
                decoded.uid;


            // =============================================
            // ROUND ID
            // =============================================

            const roundId =
                String(
                    req.body.roundId ||
                    ""
                ).trim();


            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round ID missing"

                });

            }


            // =============================================
            // USER LOCK
            // =============================================

            return await withUserLock(
                uid,
                async () => {

                    // =====================================
                    // ROUND
                    // =====================================

                    const roundSnapshot =
                        await db.ref(
                            `food_game_global/rounds/${roundId}`
                        ).once(
                            "value"
                        );


                    const round =
                        roundSnapshot.val();


                    if (!round) {

                        return res.status(404).json({

                            success:
                                false,

                            error:
                                "Round not found"

                        });

                    }


                    // =====================================
                    // WINNER
                    // =====================================

                    const winner =
                        getFoodByKey(
                            round.winnerKey
                        );


                    if (
                        !winner ||
                        Number(
                            round.winnerIndex
                        ) < 0
                    ) {

                        return res.status(400).json({

                            success:
                                false,

                            error:
                                "Winner not selected"

                        });

                    }


                    // =====================================
                    // USER REF
                    // =====================================

                    const userRef =
                        db.ref(
                            `users/${uid}`
                        );


                    // =====================================
                    // ATOMIC SETTLEMENT
                    //
                    // Diamonds + settlement marker
                    // ek Firebase transaction mein.
                    // =====================================

                    let settlementData =
                        null;

                    let payout =
                        0;

                    let winningBet =
                        0;

                    let finalBalance =
                        0;

                    let alreadySettled =
                        false;


                    const settlementTransaction =
                        await userRef.transaction(

                            user => {

                                if (!user) {

                                    return;

                                }


                                // ---------------------------------
                                // EXISTING SETTLEMENT
                                // ---------------------------------

                                if (
                                    !user
                                        .food_game_settlements
                                ) {

                                    user.food_game_settlements =
                                        {};

                                }


                                const oldSettlement =
                                    user
                                        .food_game_settlements[
                                            roundId
                                        ];


                                if (
                                    oldSettlement &&
                                    oldSettlement.status ===
                                    "paid"
                                ) {

                                    alreadySettled =
                                        true;

                                    settlementData =
                                        oldSettlement;

                                    finalBalance =
                                        Number(
                                            user.diamonds ||
                                            0
                                        );

                                    return user;

                                }


                                // ---------------------------------
                                // GET WINNING BET
                                // ---------------------------------

                                const bets =
                                    user.food_game_bets &&
                                    user.food_game_bets[
                                        roundId
                                    ]
                                        ? user.food_game_bets[
                                            roundId
                                        ]
                                        : {};


                                winningBet =
                                    Number(
                                        bets[
                                            winner.key
                                        ] ||
                                        0
                                    );


                                if (
                                    !Number.isFinite(
                                        winningBet
                                    ) ||
                                    winningBet < 0
                                ) {

                                    winningBet =
                                        0;

                                }


                                // ---------------------------------
                                // PAYOUT
                                // ---------------------------------

                                payout =
                                    winningBet *
                                    winner.multiplier;


                                const currentBalance =
                                    Number(
                                        user.diamonds ||
                                        0
                                    );


                                if (
                                    !Number.isFinite(
                                        currentBalance
                                    ) ||
                                    currentBalance < 0
                                ) {

                                    return;

                                }


                                finalBalance =
                                    currentBalance +
                                    payout;


                                user.diamonds =
                                    finalBalance;


                                // ---------------------------------
                                // SAVE SETTLEMENT
                                // ---------------------------------

                                settlementData = {

                                    status:
                                        "paid",

                                    uid:
                                        uid,

                                    roundId:
                                        roundId,

                                    food:
                                        winner.key,

                                    bet:
                                        winningBet,

                                    multiplier:
                                        winner.multiplier,

                                    win:
                                        payout,

                                    payout:
                                        payout,

                                    paidAt:
                                        now()

                                };


                                user
                                    .food_game_settlements[
                                        roundId
                                    ] =
                                    settlementData;


                                return user;

                            }

                        );


                    // =====================================
                    // TRANSACTION FAILED
                    // =====================================

                    if (
                        !settlementTransaction.committed
                    ) {

                        return res.status(409).json({

                            success:
                                false,

                            error:
                                "Settlement transaction failed",

                            roundId:
                                roundId

                        });

                    }


                    // =====================================
                    // EXISTING SETTLEMENT
                    // =====================================

                    if (
                        alreadySettled
                    ) {

                        return res.json({

                            success:
                                true,

                            alreadySettled:
                                true,

                            roundId:
                                roundId,

                            food:
                                winner.key,

                            foodName:
                                winner.name,

                            bet:
                                Number(
                                    settlementData.bet ||
                                    0
                                ),

                            multiplier:
                                winner.multiplier,

                            win:
                                Number(
                                    settlementData.win ||
                                    settlementData.payout ||
                                    0
                                ),

                            payout:
                                Number(
                                    settlementData.payout ||
                                    settlementData.win ||
                                    0
                                ),

                            diamonds:
                                finalBalance

                        });

                    }


                    // =====================================
                    // MIRROR SETTLEMENT
                    // =====================================

                    const settlementRef =
                        db.ref(
                            `food_game_global/rounds/${roundId}/settlements/${uid}`
                        );


                    await settlementRef.set(
                        settlementData
                    );


                    // =====================================
                    // NO WIN
                    // =====================================

                    if (
                        payout <= 0
                    ) {

                        const noWinResultRef =
                            db.ref(
                                `food_game_global/rounds/${roundId}/results/${uid}`
                            );


                        const userSnapshot =
                            await userRef.once(
                                "value"
                            );


                        const user =
                            userSnapshot.val() ||
                            {};


                        const userName =
                            user.name ||
                            user.user_name ||
                            user.username ||
                            user.displayName ||
                            "User";


                        const profileImage =
                            user.profile_pic ||
                            user.profile_image ||
                            user.profileImage ||
                            user.profileURL ||
                            user.profileUrl ||
                            "";


                        await noWinResultRef.set({

                            uid:
                                uid,

                            name:
                                userName,

                            profile_image:
                                profileImage,

                            food:
                                winner.name,

                            foodKey:
                                winner.key,

                            bet:
                                0,

                            multiplier:
                                winner.multiplier,

                            win:
                                0,

                            round:
                                roundId,

                            time:
                                admin.database
                                    .ServerValue
                                    .TIMESTAMP

                        });


                        return res.json({

                            success:
                                true,

                            alreadySettled:
                                false,

                            roundId:
                                roundId,

                            food:
                                winner.key,

                            foodName:
                                winner.name,

                            bet:
                                0,

                            multiplier:
                                winner.multiplier,

                            win:
                                0,

                            payout:
                                0,

                            diamonds:
                                finalBalance

                        });

                    }


                    // =====================================
                    // INDIA DATE
                    // =====================================

                    const indiaDate =
                        new Intl.DateTimeFormat(
                            "en-CA",
                            {
                                timeZone:
                                    "Asia/Kolkata",

                                year:
                                    "numeric",

                                month:
                                    "2-digit",

                                day:
                                    "2-digit"

                            }
                        ).format(
                            new Date()
                        );


                    // =====================================
                    // TODAY WIN
                    // =====================================

                    const todayRef =
                        db.ref(
                            `users/${uid}/food_game_today`
                        );


                    await todayRef.transaction(

                        current => {

                            current =
                                current ||
                                {};


                            const savedDate =
                                String(
                                    current.date ||
                                    ""
                                );


                            let oldWin =
                                Number(
                                    current.win ||
                                    0
                                );


                            if (
                                savedDate !==
                                indiaDate
                            ) {

                                oldWin =
                                    0;

                            }


                            current.date =
                                indiaDate;


                            current.win =
                                oldWin +
                                payout;


                            return current;

                        }

                    );


                    // =====================================
                    // USER PROFILE
                    // =====================================

                    const userSnapshot =
                        await userRef.once(
                            "value"
                        );


                    const user =
                        userSnapshot.val() ||
                        {};


                    const userName =
                        user.name ||
                        user.user_name ||
                        user.username ||
                        user.displayName ||
                        "User";


                    const profileImage =
                        user.profile_pic ||
                        user.profile_image ||
                        user.profileImage ||
                        user.profileURL ||
                        user.profileUrl ||
                        "";


                    // =====================================
                    // RESULT
                    // =====================================

                    const resultPath =
                        `food_game_global/rounds/${roundId}/results/${uid}`;


                    await db.ref(
                        resultPath
                    ).set({

                        uid:
                            uid,

                        name:
                            userName,

                        profile_image:
                            profileImage,

                        food:
                            winner.name,

                        foodKey:
                            winner.key,

                        bet:
                            winningBet,

                        multiplier:
                            winner.multiplier,

                        win:
                            payout,

                        round:
                            roundId,

                        time:
                            admin.database
                                .ServerValue
                                .TIMESTAMP

                    });


                    // =====================================
                    // LEADERBOARD
                    // =====================================

                    const leaderboardUserRef =
                        db.ref(
                            `food_game_global/leaderboard/${uid}`
                        );


                    await leaderboardUserRef.transaction(

                        current => {

                            current =
                                current ||
                                {};


                            const oldTotal =
                                Number(
                                    current.total_win ||
                                    0
                                );


                            current.uid =
                                uid;


                            current.name =
                                userName;


                            current.profile_image =
                                profileImage;


                            current.total_win =
                                oldTotal +
                                payout;


                            current.last_win =
                                payout;


                            current.last_food =
                                winner.name;


                            current.last_round =
                                roundId;


                            current.updated_at =
                                admin.database
                                    .ServerValue
                                    .TIMESTAMP;


                            return current;

                        }

                    );


                    // =====================================
                    // LOG
                    // =====================================

                    console.log(
                        "================================="
                    );

                    console.log(
                        "PAYOUT SUCCESS"
                    );

                    console.log(
                        "UID:",
                        uid
                    );

                    console.log(
                        "ROUND:",
                        roundId
                    );

                    console.log(
                        "FOOD:",
                        winner.name
                    );

                    console.log(
                        "WINNING BET:",
                        winningBet
                    );

                    console.log(
                        "MULTIPLIER:",
                        winner.multiplier
                    );

                    console.log(
                        "PAYOUT:",
                        payout
                    );

                    console.log(
                        "FINAL BALANCE:",
                        finalBalance
                    );

                    console.log(
                        "================================="
                    );


                    // =====================================
                    // RESPONSE
                    // =====================================

                    return res.json({

                        success:
                            true,

                        alreadySettled:
                            false,

                        roundId:
                            roundId,

                        food:
                            winner.key,

                        foodName:
                            winner.name,

                        bet:
                            winningBet,

                        multiplier:
                            winner.multiplier,

                        win:
                            payout,

                        payout:
                            payout,

                        diamonds:
                            finalBalance

                    });

                }
            );


        } catch (error) {

            console.error(
                "SETTLE ERROR:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    error.message ||
                    "Settlement failed"

            });

        }
    }
);


// =====================================================
// TOP 3
// =====================================================

app.get(
    "/game/top3/:roundId",
    async (
        req,
        res
    ) => {

        try {

            const roundId =
                String(
                    req.params.roundId ||
                    ""
                ).trim();


            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round ID missing"

                });

            }


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            const results =
                snapshot.val() ||
                {};


            const top3 =
                Object.keys(results)
                    .map(
                        uid => ({

                            uid:
                                uid,

                            ...results[uid]

                        })
                    )
                    .filter(
                        item =>
                            Number(
                                item.win ||
                                0
                            ) > 0
                    )
                    .sort(
                        (a, b) =>
                            Number(
                                b.win ||
                                0
                            ) -
                            Number(
                                a.win ||
                                0
                            )
                    )
                    .slice(
                        0,
                        3
                    );


            return res.json({

                success:
                    true,

                roundId:
                    roundId,

                top3:
                    top3

            });

        } catch (error) {

            console.error(
                "TOP3 ERROR:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get top3"

            });

        }
    }
);


// =====================================================
// RESULTS
// =====================================================

app.get(
    "/game/results/:roundId",
    async (
        req,
        res
    ) => {

        try {

            const roundId =
                String(
                    req.params.roundId ||
                    ""
                ).trim();


            if (!roundId) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "Round ID missing"

                });

            }


            const snapshot =
                await db.ref(
                    `food_game_global/rounds/${roundId}/results`
                ).once(
                    "value"
                );


            return res.json({

                success:
                    true,

                roundId:
                    roundId,

                results:
                    snapshot.val() ||
                    {}

            });

        } catch (error) {

            console.error(
                "RESULTS ERROR:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get results"

            });

        }
    }
);


// =====================================================
// HISTORY
// =====================================================

app.get(
    "/game/history",
    async (
        req,
        res
    ) => {

        try {

            const snapshot =
                await db.ref(
                    "food_game_global/result_history"
                )
                .orderByChild(
                    "createdAt"
                )
                .once(
                    "value"
                );


            const data =
                snapshot.val() ||
                {};


            const history =
                Object.keys(data)
                    .map(
                        key => ({

                            id:
                                key,

                            ...data[key]

                        })
                    )
                    .sort(
                        (a, b) =>
                            Number(
                                b.createdAt ||
                                0
                            ) -
                            Number(
                                a.createdAt ||
                                0
                            )
                    )
                    .slice(
                        0,
                        8
                    );


            return res.json({

                success:
                    true,

                history:
                    history

            });

        } catch (error) {

            console.error(
                "HISTORY ERROR:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    "Unable to get history"

            });

        }
    }
);


// =====================================================
// CONFIG
// =====================================================

app.get(
    "/game/config",
    (
        req,
        res
    ) => {

        return res.json({

            success:
                true,

            betDuration:
                BET_DURATION,

            spinDuration:
                SPIN_DURATION,

            showDuration:
                SHOW_DURATION,

            foods:
                FOODS.map(
                    food => ({

                        index:
                            food.index,

                        key:
                            food.key,

                        name:
                            food.name,

                        multiplier:
                            food.multiplier,

                        weight:
                            food.weight

                    })
                )

        });
    }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/",
    (
        req,
        res
    ) => {

        return res.json({

            success:
                true,

            server:
                "VibeCash Food Game Server",

            status:
                "online",

            firebaseProject:
                serviceAccount.project_id,

            time:
                now()

        });
    }
);


// =====================================================
// 404
// =====================================================

app.use(
    (
        req,
        res
    ) => {

        return res.status(404).json({

            success:
                false,

            error:
                "Endpoint not found",

            path:
                req.path

        });
    }
);


// =====================================================
// EXPRESS ERROR
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "EXPRESS ERROR:",
            error
        );


        return res.status(500).json({

            success:
                false,

            error:
                "Internal server error"

        });
    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "VIBECASH FOOD GAME SERVER ONLINE"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "BET:",
            BET_DURATION / 1000,
            "seconds"
        );

        console.log(
            "SPIN:",
            SPIN_DURATION / 1000,
            "seconds"
        );

        console.log(
            "RESULT:",
            SHOW_DURATION / 1000,
            "seconds"
        );

        console.log(
            "FOODS:",
            FOODS.length
        );

        console.log(
            "FIREBASE PROJECT:",
            serviceAccount.project_id
        );

        console.log(
            "DATABASE:",
            FIREBASE_DATABASE_URL
        );

        console.log(
            "================================="
        );

    }
);
