// --- DOM Elements ---
const statusMessage = document.getElementById('status-message');
const waitingMessage = document.getElementById('waiting-message');
const findGameButton = document.getElementById('find-game-button');
const playCardButton = document.getElementById('play-card-button');
const nextRoundButton = document.getElementById('next-round-button');
const player1Name = document.getElementById('player-1-name');
const player2Name = document.getElementById('player-2-name');
const hpBar1 = document.getElementById('hp-bar-1');
const hpText1 = document.getElementById('hp-text-1');
const hpBar2 = document.getElementById('hp-bar-2');
const hpText2 = document.getElementById('hp-text-2');
const playedCardArea1 = document.getElementById('played-card-area-1');
const playedCardArea2 = document.getElementById('played-card-area-2');
const playerHandArea = document.getElementById('player-hand-area');
const opponentHandInfo = document.getElementById('opponent-hand-info');
const roundResultDisplay = document.getElementById('round-result');


// --- Game State (Client-Side) ---
let socket = null;
let playerNumber = -1; // 0 or 1, assigned by server
let currentHand = [];
let selectedCardIndex = -1;
let initialHP = 5; // Will be confirmed by server, default value
let currentTurn = -1; // Who's turn is it (0 or 1)
let gameState = 'connecting'; // connecting, waiting, p0_turn, p1_turn, comparing, game_over

// --- Constants ---
const SUIT_SYMBOL = { "梅花": "♣", "方塊": "♦", "紅心": "♥", "黑桃": "♠" };
const CARD_IMAGE_PATH = 'images/'; // Path to your card images

// --- Helper Functions ---
function getCardImageUrl(card) {
    if (!card) return `${CARD_IMAGE_PATH}card_back.png`; // Return card back if no card specified
    const suitMap = { "梅花": "C", "方塊": "D", "紅心": "H", "黑桃": "S" };
    // Rank A=1, ..., 10=10
    const rank = card.rank;
    return `${CARD_IMAGE_PATH}${suitMap[card.suit]}${rank}.png`;
}

function formatCardText(card) {
     if (!card) return "";
     const rankDisplay = card.rank === 1 ? 'A' : card.rank.toString();
     return `${SUIT_SYMBOL[card.suit]} ${rankDisplay}`;
}


function updateHPDisplay(playerIdx, currentHp, maxHp) {
    const hpBar = (playerIdx === 0) ? hpBar1 : hpBar2;
    const hpText = (playerIdx === 0) ? hpText1 : hpText2;
    const percentage = Math.max(0, (currentHp / maxHp) * 100);

    hpBar.style.width = `${percentage}%`;
    hpText.textContent = `${currentHp}/${maxHp} HP`;

    // Change color based on HP percentage
    if (percentage <= 25) {
        hpBar.style.background = 'linear-gradient(to right, #d32f2f, #f44336)'; // Red
    } else if (percentage <= 60) {
        hpBar.style.background = 'linear-gradient(to right, #fbc02d, #ffeb3b)'; // Yellow
    } else {
        hpBar.style.background = 'linear-gradient(to right, #4caf50, #8bc34a)'; // Green
    }
}

function displayPlayedCard(playerIdx, card) {
    const area = (playerIdx === 0) ? playedCardArea1 : playedCardArea2;
    area.innerHTML = ''; // Clear placeholder or previous card
    if (card) {
        const img = document.createElement('img');
        img.src = getCardImageUrl(card);
        img.alt = formatCardText(card);
        img.title = formatCardText(card); // Tooltip
        area.appendChild(img);
    } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'placeholder';
        placeholder.textContent = (playerIdx === playerNumber) ? '你的出牌區' : '對手出牌區';
        area.appendChild(placeholder);
    }
}

function renderHand() {
    //console.log('--- Rendering Hand ---');
    playerHandArea.innerHTML = ''; // Clear existing cards
    const isMyTurn = (currentTurn === playerNumber) && (gameState === `p${playerNumber}_turn`);

    currentHand.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        if (!isMyTurn) {
            cardDiv.classList.add('disabled'); // Visually disable if not turn
        }
        const imageUrl = getCardImageUrl(card);
        //console.log(`Card: ${formatCardText(card)}, Image URL: ${imageUrl}`);
        cardDiv.style.backgroundImage = `url('${imageUrl}')`; // 使用 imageUrl 變數
        cardDiv.style.backgroundImage = `url('${getCardImageUrl(card)}')`;
        cardDiv.dataset.index = index; // Store index for click handling
        cardDiv.title = formatCardText(card); // Tooltip

        if (index === selectedCardIndex) {
            cardDiv.classList.add('selected');
        }

        cardDiv.addEventListener('click', () => {
            if (!isMyTurn) return; // Only allow selection on player's turn

            if (selectedCardIndex === index) {
                // Deselect if clicking the same card
                selectedCardIndex = -1;
                cardDiv.classList.remove('selected');
                playCardButton.disabled = true;
            } else {
                // Remove selection from previously selected card
                const previouslySelected = playerHandArea.querySelector('.card.selected');
                if (previouslySelected) {
                    previouslySelected.classList.remove('selected');
                }
                // Select new card
                selectedCardIndex = index;
                cardDiv.classList.add('selected');
                playCardButton.disabled = false; // Enable play button
            }
        });
        playerHandArea.appendChild(cardDiv);
    });
}

function updateUIBasedOnState(state) {
    //console.log("Received state update:", state); // Debugging

    initialHP = state.initialHP;
    currentTurn = state.currentTurn;
    gameState = state.gameState; // Sync local state with server's authoritative state

    // Update Player Names and IDs (only really needed once)
    player1Name.textContent = (playerNumber === 0) ? "你 (玩家 1)" : state.playerNames[0] || "玩家 1";
    player2Name.textContent = (playerNumber === 1) ? "你 (玩家 2)" : state.playerNames[1] || "玩家 2";

    // Update HP
    updateHPDisplay(0, state.hp[0], state.initialHP);
    updateHPDisplay(1, state.hp[1], state.initialHP);

    // Update Hand (Only receive *your* hand details)
    if (state.hands && state.hands[playerNumber]) {
        currentHand = state.hands[playerNumber];
        renderHand(); // Re-render hand based on new data
    }

    // Update opponent's hand info (just card count)
    opponentHandInfo.textContent = `對手手牌: ${state.opponentCardCount[playerNumber]}`;


    // Update Played Cards
    displayPlayedCard(0, state.playedCards[0]);
    displayPlayedCard(1, state.playedCards[1]);

    // Reset selection and disable play button if not player's turn
    const isMyTurn = (currentTurn === playerNumber) && (gameState === `p${playerNumber}_turn`);
    if (!isMyTurn) {
         if (selectedCardIndex !== -1) {
             const cardElem = playerHandArea.querySelector(`[data-index='${selectedCardIndex}']`);
             if (cardElem) cardElem.classList.remove('selected');
         }
         selectedCardIndex = -1;
         playCardButton.disabled = true;
    } else {
        // If it *is* my turn, disable play button until a card is selected
        playCardButton.disabled = (selectedCardIndex === -1);
    }

    // Update Status Message
    switch (gameState) {
        case 'waiting':
            statusMessage.textContent = '等待對手加入...';
            waitingMessage.style.display = 'block';
            findGameButton.style.display = 'none';
            playCardButton.style.display = 'none';
            nextRoundButton.style.display = 'none';
            roundResultDisplay.classList.remove('visible');
            break;
        case `p${playerNumber}_turn`: // Your turn
            statusMessage.textContent = '輪到你了，選擇一張牌並點擊 "出牌"';
             waitingMessage.style.display = 'none';
             findGameButton.style.display = 'none';
             playCardButton.style.display = 'inline-block';
             nextRoundButton.style.display = 'none';
             roundResultDisplay.classList.remove('visible');
             renderHand(); // Re-render to remove 'disabled' class if needed
            break;
        case `p${1-playerNumber}_turn`: // Opponent's turn
            statusMessage.textContent = `等待 ${state.playerNames[1-playerNumber] || `玩家 ${2-playerNumber}`} 出牌...`;
             waitingMessage.style.display = 'none';
             findGameButton.style.display = 'none';
             playCardButton.style.display = 'inline-block'; // Show but disable
             playCardButton.disabled = true; // Ensure disabled
             nextRoundButton.style.display = 'none';
             roundResultDisplay.classList.remove('visible');
              renderHand(); // Re-render to add 'disabled' class
            break;
        case 'comparing':
             statusMessage.textContent = '比較卡牌中...';
             waitingMessage.style.display = 'none';
             findGameButton.style.display = 'none';
             playCardButton.style.display = 'none';
             nextRoundButton.style.display = 'none';
             // Result will be shown via 'round_result' event
             roundResultDisplay.classList.remove('visible');
             break;
        case 'game_over':
            statusMessage.textContent = '遊戲結束！';
             waitingMessage.style.display = 'none';
             findGameButton.textContent = '再玩一局'; // Change button text
             findGameButton.style.display = 'inline-block'; // Show find game button again
             playCardButton.style.display = 'none';
             nextRoundButton.style.display = 'none';
             // Result shown via 'game_over' event
             break;
        default:
            statusMessage.textContent = '發生錯誤或狀態未知';
    }
}


// --- WebSocket Event Handlers ---
function setupSocketListeners() {
    socket.on('connect', () => {
        
        statusMessage.textContent = '已連接伺服器！點擊按鈕尋找遊戲。';
        gameState = 'connected';
        findGameButton.disabled = false;
         findGameButton.style.display = 'inline-block';
         waitingMessage.style.display = 'none';
         playCardButton.style.display = 'none';
         nextRoundButton.style.display = 'none';
         roundResultDisplay.classList.remove('visible');

         // Reset UI elements in case of reconnection
         player1Name.textContent = '你';
         player2Name.textContent = '對手';
         updateHPDisplay(0, initialHP, initialHP);
         updateHPDisplay(1, initialHP, initialHP);
         displayPlayedCard(0, null);
         displayPlayedCard(1, null);
         playerHandArea.innerHTML = '';
         opponentHandInfo.textContent = '對手手牌: ?';

    });

    socket.on('disconnect', () => {
        statusMessage.textContent = '已斷線，請重新整理頁面。';
        gameState = 'disconnected';
        findGameButton.disabled = true;
        playCardButton.disabled = true;
        nextRoundButton.disabled = true;
         waitingMessage.style.display = 'none';
         // Optionally clear UI or show an overlay
    });

    socket.on('assign_player_number', (data) => {
        playerNumber = data.playerNumber;
        initialHP = data.initialHP; // Get initial HP from server
        //console.log(`You are Player ${playerNumber + 1}`);
        // Update initial UI state
        player1Name.textContent = (playerNumber === 0) ? "你 (玩家 1)" : "玩家 1";
        player2Name.textContent = (playerNumber === 1) ? "你 (玩家 2)" : "玩家 2";
        updateHPDisplay(0, initialHP, initialHP);
        updateHPDisplay(1, initialHP, initialHP);
    });

     socket.on('waiting_for_opponent', () => {
        gameState = 'waiting';
        statusMessage.textContent = '已加入佇列，正在等待對手...';
         waitingMessage.style.display = 'block';
         findGameButton.style.display = 'none';
    });

    socket.on('game_start', (initialState) => {
      //  console.log('--- Game Start Event Received ---');
      //  console.log('Initial State:', initialState);
      //  console.log('Game Start!');
        waitingMessage.style.display = 'none';
        updateUIBasedOnState(initialState); // Initial full update
    });

    socket.on('game_state_update', (newState) => {
      //  console.log('--- Game State Update Received ---');
      //  console.log('New State:', newState);
        updateUIBasedOnState(newState);
    });

     socket.on('round_result', (result) => {
        // { winner: 0|1, loser: 0|1, playedCards: [card1, card2], hp: [hp1, hp2], message: "..." }
       // console.log("Round Result:", result);
        gameState = 'comparing'; // Update local state
        roundResultDisplay.innerHTML = result.message.replace(/\n/g, '<br>'); // Display result message
        roundResultDisplay.classList.add('visible');

        // Update HP immediately based on result data
        updateHPDisplay(0, result.hp[0], initialHP);
        updateHPDisplay(1, result.hp[1], initialHP);

        // Briefly highlight winner/loser cards? (Optional enhancement)

        // Show next round button only if it's the winner's turn to click it (or designated player)
        // Server now controls the flow, client just waits for next state update
         playCardButton.style.display = 'none'; // Hide play button during result display
         // The server will send the next turn state after a delay

          // Simple logic: if it was my turn, I enable the next round button
        // Better: Server controls this flow entirely via state updates. Let's rely on server.
        // if (currentTurn === playerNumber) {
             // nextRoundButton.style.display = 'inline-block';
             // nextRoundButton.disabled = false;
        // } else {
             // nextRoundButton.style.display = 'none';
        // }
         nextRoundButton.style.display = 'none'; // Server handles transition


    });

     socket.on('next_turn', (nextState) => {
         //console.log("Starting Next Turn");
         roundResultDisplay.classList.remove('visible'); // Hide previous result
         displayPlayedCard(0, null); // Clear played cards visually
         displayPlayedCard(1, null);
         updateUIBasedOnState(nextState); // Update to the new turn state
          nextRoundButton.style.display = 'none'; // Hide button again
    });


    socket.on('game_over', (result) => {
        gameState = 'game_over';
        statusMessage.textContent = '遊戲結束！';
        roundResultDisplay.innerHTML = result.message.replace(/\n/g, '<br>');
        roundResultDisplay.classList.add('visible'); // Show final message

        findGameButton.textContent = '再玩一局';
        findGameButton.style.display = 'inline-block';
        findGameButton.disabled = false;
        playCardButton.style.display = 'none';
        nextRoundButton.style.display = 'none';
        waitingMessage.style.display = 'none';

        // Optionally disable hand interaction visually
        const cards = playerHandArea.querySelectorAll('.card');
        cards.forEach(card => card.classList.add('disabled'));
    });

     socket.on('error_message', (data) => {
        console.error("Server Error:", data.message);
        // Display error to user in a non-intrusive way if possible
        statusMessage.textContent = `錯誤: ${data.message}`;
        // Maybe reset state or buttons depending on error type
    });
}

// --- Event Listeners ---
findGameButton.addEventListener('click', () => {
    if (socket && socket.connected) {
        //console.log("Sending find_game event");
        socket.emit('find_game');
        statusMessage.textContent = '正在尋找對手...';
        findGameButton.disabled = true;
        findGameButton.style.display = 'none'; // Hide while searching
        waitingMessage.style.display = 'block';
         roundResultDisplay.classList.remove('visible'); // Hide results from previous game
    } else {
        statusMessage.textContent = '未連接到伺服器，請稍後或重新整理。';
    }
});

playCardButton.addEventListener('click', () => {
    if (selectedCardIndex !== -1 && socket && socket.connected) {
     //   console.log(`Playing card index: ${selectedCardIndex}`);
        socket.emit('play_card', { cardIndex: selectedCardIndex });
        playCardButton.disabled = true; // Disable until server confirms or next turn
        // Visually indicate the card is "sent" (optional)
    } else {
      //  console.log("No card selected or not connected");
       // Optionally show a brief message if no card is selected
         if(selectedCardIndex === -1) {
             // Maybe flash the status message briefly?
            const oldMsg = statusMessage.textContent;
            statusMessage.textContent = "請先選擇一張手牌！";
            setTimeout(() => { statusMessage.textContent = oldMsg; }, 1500);
         }
    }
});

// Next Round Button - Now primarily controlled by server state changes
// nextRoundButton.addEventListener('click', () => {
//     if (socket && socket.connected) {
//         console.log("Requesting next round (client action - might be removed)");
//         // Server should ideally trigger the next round automatically after a delay
//         // Keeping this temporarily might help debug, but the flow should be server-driven
//         socket.emit('request_next_round'); // Example event, might not be needed
//         nextRoundButton.disabled = true;
//         nextRoundButton.style.display = 'none';
//         roundResultDisplay.classList.remove('visible');
//     }
// });


// --- Initialization ---
function init() {
    statusMessage.textContent = '正在連接伺服器...';
    findGameButton.disabled = true; // Disable until connected
    playCardButton.style.display = 'none';
    nextRoundButton.style.display = 'none';

    // Attempt to connect to the server
    // Assumes server is running on the same host/port for simplicity
    // If your server is elsewhere, change the URL: io('http://your-server-address.com');
    try {
        socket = io(); // Connects to the server that serves the page
        setupSocketListeners();
    } catch (error) {
        console.error("Socket.IO connection failed:", error);
        statusMessage.textContent = '無法連接伺服器。請確保伺服器正在運行並重新整理頁面。';
    }
}

// Start the client-side application
init();