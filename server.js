const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path'); // To serve static files

const app = express();
const server = http.createServer(app);
// Allow connections from any origin in development. Be more specific in production.
const io = new Server(server, {
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- Game Constants (Server Side) ---
const SUITS = ["梅花", "方塊", "紅心", "黑桃"];
const RANKS = Array.from({ length: 10 }, (_, i) => i + 1);
const SUIT_RANKING = { "梅花": 1, "方塊": 2, "紅心": 3, "黑桃": 4 };
const INITIAL_HP = 5;
const HAND_SIZE = 10;
const MAX_PLAYERS_PER_ROOM = 2;
const ROUND_RESULT_DELAY = 2000; // ms delay before starting next turn
// --- Game State Management ---
let rooms = {}; // Stores active game rooms: rooms[roomId] = { players: [], gameState: {} }
let waitingPlayer = null; // Holds the socket ID of a player waiting for an opponent

// --- Helper Functions ---
function createDeck() { /* ... (same as client) ... */
    const newDeck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            newDeck.push({ suit, rank }); // Store as object
        }
    }
    return newDeck;
}

function shuffleDeck(deckToShuffle) { /* ... (same as client) ... */
    for (let i = deckToShuffle.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckToShuffle[i], deckToShuffle[j]] = [deckToShuffle[j], deckToShuffle[i]]; // Swap
    }
}

function dealCards(deckToDeal) { /* ... (same as client, deals two hands) ... */
    const hands = [[], []];
    if (deckToDeal.length < HAND_SIZE * 2) {
        console.error("Not enough cards in deck to deal!");
        // Handle this error appropriately, maybe reshuffle discard pile if implemented
        return hands; // Return empty hands or handle error
    }
    for (let i = 0; i < HAND_SIZE; i++) {
        hands[0].push(deckToDeal.pop());
        hands[1].push(deckToDeal.pop());
    }
     // Sort hands for consistency (optional on server)
    // hands[0].sort((a, b) => SUIT_RANKING[a.suit] - SUIT_RANKING[b.suit] || a.rank - b.rank);
    // hands[1].sort((a, b) => SUIT_RANKING[a.suit] - SUIT_RANKING[b.suit] || a.rank - b.rank);
    return hands;
}

function compareCards(card1, card2) { /* ... (same as client) ... */
    if (!card1 || !card2) return -1; // Error case
    if (card1.rank > card2.rank) return 0; // Player 0 wins
    if (card2.rank > card1.rank) return 1; // Player 1 wins
    if (SUIT_RANKING[card1.suit] > SUIT_RANKING[card2.suit]) return 0;
    if (SUIT_RANKING[card2.suit] > SUIT_RANKING[card1.suit]) return 1;
    return -1; // Should not happen with unique cards
}

function createInitialGameState(playerSockets) {
    const deck = createDeck();
    shuffleDeck(deck);
    const hands = dealCards(deck); // hands[0] for player 0, hands[1] for player 1

    return {
        players: [playerSockets[0].id, playerSockets[1].id], // Store socket IDs
        playerNames: ["玩家 1", "玩家 2"], // Default names
        deck: deck, // Remaining cards
        hands: hands,
        hp: [INITIAL_HP, INITIAL_HP],
        playedCards: [null, null],
        currentTurn: 0, // Player 0 starts
        gameState: 'p0_turn', // Initial state: Player 0's turn
        initialHP: INITIAL_HP,
        roundWinner: null,
        gameOver: false,
        winner: null, // Overall game winner
    };
}

// Function to get state tailored for a specific player (hides opponent's hand)
function getPlayerSpecificState(roomId, playerIndex) {
    const room = rooms[roomId];
    if (!room) return null;
    const state = room.gameState;

    return {
        playerNames: state.playerNames,
        hp: state.hp,
        playedCards: state.playedCards,
        currentTurn: state.currentTurn,
        gameState: state.gameState,
        initialHP: state.initialHP,
        // Only send the player their own hand
        hands: { [playerIndex]: state.hands[playerIndex] },
        // Send opponent's card count
        opponentCardCount: {
             [playerIndex]: state.hands[1 - playerIndex]?.length ?? 0 // Card count for the opponent
        }
    };
}

// Function to broadcast state to both players in a room
function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if (!room || !room.players || room.players.length < 2) return; // Need two players

    const stateP0 = getPlayerSpecificState(roomId, 0);
    const stateP1 = getPlayerSpecificState(roomId, 1);

    if (stateP0 && room.players[0]) {
        io.to(room.players[0]).emit('game_state_update', stateP0);
         // console.log(`Sent state to P0 (${room.players[0]}):`, stateP0);
    }
    if (stateP1 && room.players[1]) {
        io.to(room.players[1]).emit('game_state_update', stateP1);
         // console.log(`Sent state to P1 (${room.players[1]}):`, stateP1);
    }
}


// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('find_game', () => {
        console.log(`Player ${socket.id} is looking for a game.`);
        // Assign player number temporarily (will be confirmed when game starts)
        // This is just for the client UI before pairing
        socket.emit('assign_player_number', { playerNumber: waitingPlayer ? 1 : 0, initialHP: INITIAL_HP });


        if (waitingPlayer) {
            // Start a game
            const player1Socket = waitingPlayer;
            const player2Socket = socket;
            const roomId = `${player1Socket.id}-${player2Socket.id}`; // Simple room ID

             console.log(`Pairing ${player1Socket.id} (P1) and ${player2Socket.id} (P2) in room ${roomId}`);

             // Reset waiting player
             waitingPlayer = null;

             // Have both players join the Socket.IO room
             player1Socket.join(roomId);
             player2Socket.join(roomId);

             // Store room information
            rooms[roomId] = {
                players: [player1Socket.id, player2Socket.id],
                sockets: [player1Socket, player2Socket], // Store socket objects for easy access
                gameState: createInitialGameState([player1Socket, player2Socket]),
            };

             // Notify players the game is starting and send initial state
             const initialStateP0 = getPlayerSpecificState(roomId, 0);
             const initialStateP1 = getPlayerSpecificState(roomId, 1);

             player1Socket.emit('game_start', initialStateP0);
             player2Socket.emit('game_start', initialStateP1);

             console.log(`Game started in room ${roomId}. State:`, rooms[roomId].gameState);


        } else {
            // No opponent waiting, make this player wait
            waitingPlayer = socket;
            socket.emit('waiting_for_opponent');
             console.log(`Player ${socket.id} is now waiting.`);
        }
    });

    socket.on('play_card', (data) => {
        // Find the room this player is in
        const roomId = Object.keys(rooms).find(id => rooms[id]?.players.includes(socket.id));
        if (!roomId || !rooms[roomId]) {
            socket.emit('error_message', { message: 'Not currently in a game.' });
            return;
        }

        const room = rooms[roomId];
        const state = room.gameState;
        const playerIndex = room.players.indexOf(socket.id); // 0 or 1

        // Validate turn and state
        if (state.gameOver) return; // Game already over
        if (playerIndex === -1) return; // Player not found in room?
        if (state.currentTurn !== playerIndex) {
             socket.emit('error_message', { message: 'Not your turn.' });
             return;
        }
         if (state.gameState !== `p${playerIndex}_turn`) {
             socket.emit('error_message', { message: 'Invalid game state to play.' });
             return;
         }

        // Validate card index
        const cardIndex = data.cardIndex;
        if (cardIndex < 0 || cardIndex >= state.hands[playerIndex].length) {
            socket.emit('error_message', { message: 'Invalid card selection.' });
            return;
        }

        // Play the card
        const playedCard = state.hands[playerIndex].splice(cardIndex, 1)[0];
        state.playedCards[playerIndex] = playedCard;
         console.log(`Player ${playerIndex + 1} (${socket.id}) played: ${playedCard.suit} ${playedCard.rank}`);


        // Check if both players have played
        if (state.playedCards[0] && state.playedCards[1]) {
            // Both played, resolve the round
             state.gameState = 'comparing'; // Update state first
             broadcastGameState(roomId); // Show both played cards

            setTimeout(() => { // Add delay before showing result
                const winnerIndex = compareCards(state.playedCards[0], state.playedCards[1]);
                 let roundMessage = '';

                if (winnerIndex !== -1) {
                    const loserIndex = 1 - winnerIndex;
                    state.hp[loserIndex] -= 1;
                    state.roundWinner = winnerIndex;
                     roundMessage = `回合結果：玩家 ${winnerIndex + 1} (${formatCardText(state.playedCards[winnerIndex])}) 勝！\n玩家 ${loserIndex + 1} (${formatCardText(state.playedCards[loserIndex])}) 扣 1 HP。`;
                } else {
                    roundMessage = "回合平手！(異常情況)"; // Should not happen
                    state.roundWinner = null;
                }
                roundMessage += `\n當前 HP: P1=${state.hp[0]}, P2=${state.hp[1]}`;
                 console.log(roundMessage.replace('\n', ' ')); // Log result

                 // Emit round result to both players
                 const roundResultData = {
                     winner: winnerIndex,
                     loser: (winnerIndex !== -1) ? 1 - winnerIndex : null,
                     playedCards: state.playedCards,
                     hp: state.hp,
                     message: roundMessage,
                 };
                 io.to(roomId).emit('round_result', roundResultData);


                // Check for game over
                if (state.hp[0] <= 0 || state.hp[1] <= 0 || state.hands[0].length === 0) { // Check if hands are empty too
                    state.gameOver = true;
                     let finalMessage = "遊戲結束！";
                     let gameWinner = -1;

                     if (state.hp[0] <= 0 && state.hp[1] <= 0) { // Both reach 0 same time or hands empty & equal HP
                        finalMessage += "\n平手！";
                     } else if (state.hp[1] <= 0 || (state.hands[0].length === 0 && state.hp[0] > state.hp[1])) {
                         finalMessage += `\n玩家 1 獲勝！ (HP: ${state.hp[0]})`;
                         gameWinner = 0;
                     } else if (state.hp[0] <= 0 || (state.hands[0].length === 0 && state.hp[1] > state.hp[0])) {
                         finalMessage += `\n玩家 2 獲勝！ (HP: ${state.hp[1]})`;
                         gameWinner = 1;
                     } else { // Should only happen if hands run out with different HP
                        if (state.hp[0] > state.hp[1]) {
                            finalMessage += `\n玩家 1 以較高血量獲勝！ (HP: ${state.hp[0]} vs ${state.hp[1]})`;
                             gameWinner = 0;
                         } else { // P2 HP > P1 HP
                            finalMessage += `\n玩家 2 以較高血量獲勝！ (HP: ${state.hp[1]} vs ${state.hp[0]})`;
                             gameWinner = 1;
                         }
                     }
                    state.winner = gameWinner;
                    state.gameState = 'game_over';
                     console.log(`Game Over in room ${roomId}. Winner: Player ${gameWinner !== -1 ? gameWinner + 1 : 'None (Draw)'}`);

                    io.to(roomId).emit('game_over', { winner: gameWinner, message: finalMessage });

                    // Clean up the room after a delay? Or wait for players to leave/find new game
                    // delete rooms[roomId]; // Be careful with timing if players might want to see result

                } else {
                     // Prepare for next round after another delay
                     setTimeout(() => {
                        state.playedCards = [null, null]; // Clear played cards
                        // Winner of the last round starts the next? Or alternate? Let's alternate.
                        state.currentTurn = 1 - state.currentTurn;
                        state.gameState = `p${state.currentTurn}_turn`;
                        state.roundWinner = null;
                         console.log(`Starting next turn. Player ${state.currentTurn + 1}'s turn.`);

                         // Send the state update that signals the next turn
                         const nextTurnStateP0 = getPlayerSpecificState(roomId, 0);
                         const nextTurnStateP1 = getPlayerSpecificState(roomId, 1);
                          if (room.players[0]) io.to(room.players[0]).emit('next_turn', nextTurnStateP0);
                          if (room.players[1]) io.to(room.players[1]).emit('next_turn', nextTurnStateP1);

                     }, ROUND_RESULT_DELAY); // Delay before starting next round
                }

            }, 1000); // Delay before calculating/showing result

        } else {
            // Only one player has played, switch turn
            state.currentTurn = 1 - playerIndex;
            state.gameState = `p${state.currentTurn}_turn`;
            broadcastGameState(roomId); // Update state to show one card played and switch turn
             console.log(`Player ${playerIndex + 1} played. Now Player ${state.currentTurn + 1}'s turn.`);
        }
    });

    // Handle player leaving/disconnecting
    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: ${socket.id}. Reason: ${reason}`);

        // If the player was waiting, clear the waiting spot
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
            console.log('Waiting player disconnected.');
        }

        // Find the room the player was in
        const roomId = Object.keys(rooms).find(id => rooms[id]?.players.includes(socket.id));
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const playerIndex = room.players.indexOf(socket.id);
             console.log(`Player ${playerIndex + 1} (${socket.id}) disconnected from room ${roomId}`);

            // Notify the other player
            const remainingPlayerId = room.players[1 - playerIndex];
            if (remainingPlayerId && io.sockets.sockets.get(remainingPlayerId)) { // Check if the other player is still connected
                 io.to(remainingPlayerId).emit('game_over', { winner: 1 - playerIndex, message: `對手已斷線。\n你獲勝了！` });
                 io.to(remainingPlayerId).emit('error_message', { message: `對手 (${room.gameState.playerNames[playerIndex]}) 已離開遊戲。` });
            }

            // Clean up the room
            delete rooms[roomId];
             console.log(`Room ${roomId} closed due to disconnect.`);
        }
    });

     // Helper function format card text (can be shared)
     function formatCardText(card) {
         if (!card) return "";
          const SUIT_SYMBOL = { "梅花": "♣", "方塊": "♦", "紅心": "♥", "黑桃": "♠" };
         const rankDisplay = card.rank === 1 ? 'A' : card.rank.toString();
         return `${SUIT_SYMBOL[card.suit]} ${rankDisplay}`;
     }

});

// --- Serve Static Files ---
// Serve HTML, CSS, JS, and images from the project root directory
// 明確地為 /images 路徑指定靜態資料夾
app.use('/images', express.static(path.join(__dirname, 'images')));
// 為根目錄提供其他靜態檔案 (CSS, JS)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`Server listening on *:${PORT}`);
});