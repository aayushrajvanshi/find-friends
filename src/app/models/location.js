import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('Location', new Schema({
    email_id: {
        type: String,
        required: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    }
}));