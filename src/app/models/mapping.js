import mongoose from 'mongoose';
const Schema = mongoose.Schema;

module.exports = mongoose.model('Mapping', new Schema({
    email_id: {
        type: String,
        required: true
    },
    friend_email_id: {
        type: String,
        required: true
    },
}));